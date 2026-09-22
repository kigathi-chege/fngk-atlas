import { copyFile, chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import type { BootstrapProgress, InstallResult } from "./types.js";
import type { VerifiedArtifact } from "./artifacts.js";
import { onboardingError } from "./artifacts.js";

const execFileAsync = promisify(execFile);
export interface ArchiveEntry { path: string; kind: "file" | "directory" | "symlink" | "hardlink" | "other"; }
export interface InstallOptions {
  userInstallDir?: string;
  systemInstallDir?: string;
  elevate?: () => Promise<{ installDir: string }>;
  extract?: (archive: Buffer, directory: string) => Promise<ArchiveEntry[]>;
  replace?: (temporary: string, target: string) => Promise<void>;
}

export async function installFngk(artifact: VerifiedArtifact, scope: "user" | "system", progress: (event: BootstrapProgress) => void, options: InstallOptions = {}): Promise<InstallResult> {
  const installDir = await targetDirectory(scope, options);
  await mkdir(installDir, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(path.join(tmpdir(), "atlas-fngk-install-"));
  const target = path.join(installDir, process.platform === "win32" ? "fngk.exe" : "fngk"), backup = `${target}.atlas-backup`, temporary = path.join(installDir, `.fngk-${randomUUID()}.new`);
  try {
    emit(progress, "verifying", 10, "Validating the FNGK archive.");
    const entries = await (options.extract ?? extractTarGzip)(artifact.archive, staging);
    validateEntries(entries);
    const source = path.join(staging, "fngk");
    if (!(await regularFile(source))) throw onboardingError("FNGK archive does not contain a safe executable.", "artifact_executable_missing");
    emit(progress, "installing", 65, "Installing FNGK.");
    if (await regularFile(target)) await copyFile(target, backup);
    await copyFile(source, temporary); await chmod(temporary, 0o755);
    await (options.replace ?? atomicReplace)(temporary, target);
    emit(progress, "complete", 100, "FNGK is installed.");
    return { protocolVersion: "atlas.desktop-bootstrap.v1", state: "checking", message: "FNGK installation completed.", installedPath: target, version: artifact.artifact ? undefined : undefined, rolledBack: false };
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    if ((error as { code?: string }).code) throw error;
    throw onboardingError("FNGK installation could not safely replace the existing binary.", "artifact_install_failed");
  } finally { await rm(staging, { recursive: true, force: true }); }
}

export async function rollbackFngk(input: { backupPath: string; targetPath: string }): Promise<void> {
  if (!(await regularFile(input.backupPath))) throw onboardingError("No FNGK backup is available.", "artifact_backup_missing");
  const temporary = `${input.targetPath}.${randomUUID()}.rollback`;
  await copyFile(input.backupPath, temporary); await chmod(temporary, 0o755); await atomicReplace(temporary, input.targetPath);
}

async function targetDirectory(scope: "user" | "system", options: InstallOptions): Promise<string> {
  if (scope === "user") return options.userInstallDir ?? userBinDirectory();
  if (!options.elevate) throw onboardingError("System installation requires explicit operating-system elevation.", "elevation_required");
  return (await options.elevate()).installDir;
}

function userBinDirectory(): string {
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA ?? homedir(), "Atlas", "bin");
  if (process.platform === "darwin") return path.join(homedir(), "Library", "Application Support", "Atlas", "bin");
  return path.join(homedir(), ".local", "bin");
}

function emit(progress: (event: BootstrapProgress) => void, phase: BootstrapProgress["phase"], value: number, message: string): void {
  progress({ protocolVersion: "atlas.desktop-bootstrap.v1", operationId: "install", state: "checking", phase, progress: value, message });
}

function validateEntries(entries: ArchiveEntry[]): void {
  for (const entry of entries) {
    const normalized = path.posix.normalize(entry.path);
    if (!entry.path || path.posix.isAbsolute(entry.path) || normalized === ".." || normalized.startsWith("../") || entry.path.includes("\0")) throw onboardingError("FNGK archive contains an unsafe path.", "artifact_path_escape");
    if (entry.kind === "symlink" || entry.kind === "hardlink") throw onboardingError("FNGK archives cannot contain links.", "artifact_symlink_rejected");
  }
}

async function extractTarGzip(archive: Buffer, directory: string): Promise<ArchiveEntry[]> {
  const archivePath = path.join(directory, "artifact.tar.gz"); await writeFile(archivePath, archive, { mode: 0o600 });
  const [names, verbose] = await Promise.all([execFileAsync("tar", ["-tzf", archivePath], { maxBuffer: 1024 * 1024 }), execFileAsync("tar", ["-tvzf", archivePath], { maxBuffer: 1024 * 1024 })]);
  const lines = names.stdout.trim().split(/\r?\n/).filter(Boolean), types = verbose.stdout.trim().split(/\r?\n/).filter(Boolean);
  const entries = lines.map((entry, index) => ({ path: entry, kind: types[index]?.startsWith("l") ? "symlink" as const : types[index]?.startsWith("h") ? "hardlink" as const : entry.endsWith("/") ? "directory" as const : "file" as const }));
  validateEntries(entries); await execFileAsync("tar", ["-xzf", archivePath, "-C", directory], { maxBuffer: 1024 * 1024 }); return entries;
}

async function atomicReplace(temporary: string, target: string): Promise<void> { await rename(temporary, target); }
async function regularFile(value: string): Promise<boolean> { try { return (await stat(value)).isFile(); } catch { return false; } }

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { downloadFngkArtifact, onboardingError, verifyFngkArtifact } from "./artifacts.js";
import { installExecutable, installFngk, rollbackFngk, userBinDirectory } from "./installer.js";
import { createSignatureVerifier, DEFAULT_FNGK_MANIFEST_URL, fetchTrustedManifest, manifestPublicKeys } from "./manifest-trust.js";
import { BOOTSTRAP_PROTOCOL_VERSION, isFngkArchitecture, type BootstrapProgress, type FngkArchitecture, type FngkPlatform, type InstallResult } from "./types.js";
import { compareVersions, parseVersionOutput } from "./version.js";

const execFileAsync = promisify(execFile);

/**
 * What the desktop host told the server at launch (see desktop/src-tauri/src/main.rs).
 * Outside the desktop app every field but `manifestUrl` is usually absent.
 */
export interface DesktopFngkEnvironment {
  desktop: boolean;
  atlasVersion?: string;
  bundledPath?: string;
  bundledSha256?: string;
  bundledVersion?: string;
  installPath?: string;
  markerPath?: string;
  provision?: string;
  provisionError?: string;
  manifestUrl: string;
}

export function desktopEnvironment(env: NodeJS.ProcessEnv = process.env): DesktopFngkEnvironment {
  const value = (key: string) => env[key]?.trim() || undefined;
  return {
    desktop: env.ATLAS_DESKTOP === "1",
    atlasVersion: value("ATLAS_VERSION"),
    bundledPath: value("ATLAS_FNGK_BUNDLED"),
    bundledSha256: value("ATLAS_FNGK_BUNDLED_SHA256"),
    bundledVersion: value("ATLAS_FNGK_BUNDLED_VERSION"),
    installPath: value("ATLAS_FNGK_INSTALL_PATH"),
    markerPath: value("ATLAS_FNGK_INSTALL_MARKER"),
    provision: value("ATLAS_FNGK_PROVISION"),
    provisionError: value("ATLAS_FNGK_PROVISION_ERROR"),
    manifestUrl: value("ATLAS_FNGK_MANIFEST_URL") ?? DEFAULT_FNGK_MANIFEST_URL,
  };
}

export interface FngkUpdateCheck {
  currentVersion?: string;
  latestVersion?: string;
  available: boolean;
  manifestUrl: string;
  errorCode?: string;
  message?: string;
}

export interface ProvisionerDependencies {
  publicKeys?: readonly string[];
  fetcher?: typeof fetch;
  platform?: FngkPlatform;
  architecture?: FngkArchitecture;
  probeVersion?: (binary: string) => Promise<string | undefined>;
}

interface Marker { path: string; sha256: string; version: string }
type Emit = (event: BootstrapProgress) => void;

/**
 * Installs and updates the per-user FNGK that Atlas and the FNGK daemon run.
 *
 * Sources, in order: the binary bundled with this Atlas build (checksum pinned
 * by the desktop host), then the signed `fngk/latest.json` manifest. Every
 * replacement keeps `<target>.atlas-backup`; a downloaded update that does not
 * run is rolled back.
 */
export class FngkProvisioner {
  readonly #publicKeys: readonly string[];
  readonly #probe: (binary: string) => Promise<string | undefined>;
  readonly #platform: FngkPlatform;
  readonly #architecture: FngkArchitecture;

  constructor(readonly environment: DesktopFngkEnvironment, private readonly dependencies: ProvisionerDependencies = {}) {
    this.#publicKeys = dependencies.publicKeys ?? manifestPublicKeys();
    this.#probe = dependencies.probeVersion ?? probeVersion;
    this.#platform = dependencies.platform ?? (process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux");
    this.#architecture = dependencies.architecture ?? (isFngkArchitecture(process.arch) ? process.arch : "x64");
  }

  get target(): string {
    return this.environment.installPath ?? path.join(userBinDirectory(), process.platform === "win32" ? "fngk.exe" : "fngk");
  }

  async currentVersion(): Promise<string | undefined> {
    return (await regularFile(this.target)) ? this.#probe(this.target) : undefined;
  }

  /** The `installBinary` hook for BootstrapService: bundled first, then a signed update. */
  async installBinary(scope: "user" | "system", emit: Emit, signal?: AbortSignal): Promise<InstallResult> {
    if (scope === "system") return result("recoverable-error", "System installation requires explicit operating-system elevation.", { errorCode: "elevation_required" });
    if (await this.#bundledShouldInstall()) return this.#installBundled(emit);
    const check = await this.checkForUpdate(signal);
    if (check.available) return this.applyUpdate(emit, signal);
    if (await regularFile(this.target)) return result("checking", "FNGK is installed and current.", { installedPath: this.target, version: check.currentVersion });
    return result("recoverable-error", check.message ?? "No FNGK installer is available.", { errorCode: check.errorCode ?? "installer_unavailable" });
  }

  async checkForUpdate(signal?: AbortSignal): Promise<FngkUpdateCheck> {
    const manifestUrl = this.environment.manifestUrl, currentVersion = await this.currentVersion();
    try {
      abortIfNeeded(signal);
      const { manifest } = await fetchTrustedManifest(manifestUrl, this.#platform, this.#architecture, { publicKeys: this.#publicKeys, fetcher: this.dependencies.fetcher });
      const newer = currentVersion === undefined || compareVersions(manifest.version, currentVersion) === 1;
      return { currentVersion, latestVersion: manifest.version, available: newer, manifestUrl };
    } catch (error) {
      const { code, message } = error as { code?: string; message?: string };
      return { currentVersion, available: false, manifestUrl, errorCode: code ?? "update_check_failed", message: message ?? "FNGK update check failed." };
    }
  }

  /** Download → verify (size, sha256, Ed25519) → install → probe → rollback on failure. */
  async applyUpdate(emit: Emit, signal?: AbortSignal): Promise<InstallResult> {
    emit(progress("checking", 5, "Checking the signed FNGK manifest."));
    const { manifest, artifact } = await fetchTrustedManifest(this.environment.manifestUrl, this.#platform, this.#architecture, { publicKeys: this.#publicKeys, fetcher: this.dependencies.fetcher });
    const current = await this.currentVersion();
    if (current !== undefined && compareVersions(manifest.version, current) !== 1) return result("checking", "FNGK is already current.", { installedPath: this.target, version: current });
    abortIfNeeded(signal);
    emit(progress("downloading", 20, `Downloading FNGK ${manifest.version}.`));
    const archive = await downloadFngkArtifact(artifact.url, { fetcher: this.dependencies.fetcher });
    const verified = await verifyFngkArtifact(manifest, archive, this.#platform, this.#architecture, { verifySignature: createSignatureVerifier(this.#publicKeys) });
    abortIfNeeded(signal);
    const installed = await installFngk(verified, "user", emit, { userInstallDir: path.dirname(this.target) });
    const target = installed.installedPath ?? this.target, backupPath = `${target}.atlas-backup`;
    const running = await this.#probe(target).catch(() => undefined);
    if (running === undefined || compareVersions(running, manifest.version) !== 0) {
      if (current !== undefined) await rollbackFngk({ backupPath, targetPath: target });
      return result("recoverable-error", `FNGK ${manifest.version} did not start correctly${current !== undefined ? `; restored ${current}` : ""}.`, { errorCode: "artifact_probe_failed", installedPath: target, version: current, rolledBack: current !== undefined });
    }
    await this.#writeMarker(target, manifest.version);
    return { ...installed, version: manifest.version, message: `FNGK ${manifest.version} is installed.` };
  }

  async #bundledShouldInstall(): Promise<boolean> {
    const { bundledPath, bundledSha256, bundledVersion } = this.environment;
    if (!bundledPath || !bundledSha256 || !(await regularFile(bundledPath))) return false;
    if (!(await regularFile(this.target))) return true;
    const currentSha = await sha256File(this.target);
    if (currentSha === bundledSha256.toLowerCase()) return false;
    const installed = await this.#probe(this.target).catch(() => undefined);
    const order = installed && bundledVersion ? compareVersions(bundledVersion, installed) : undefined;
    if (order !== undefined && order !== 0) return order === 1;
    const marker = await this.#readMarker();
    return marker?.path === this.target && marker.sha256 === currentSha;
  }

  async #installBundled(emit: Emit): Promise<InstallResult> {
    const { bundledPath, bundledSha256, bundledVersion } = this.environment;
    emit(progress("verifying", 10, "Verifying the FNGK bundled with Atlas."));
    if ((await sha256File(bundledPath!)) !== bundledSha256!.toLowerCase()) throw onboardingError("The bundled FNGK did not pass checksum verification.", "artifact_checksum_mismatch");
    const installed = await installExecutable(bundledPath!, this.target, emit);
    if ((await sha256File(this.target)) !== bundledSha256!.toLowerCase()) {
      if (installed.backupPath) await rollbackFngk({ backupPath: installed.backupPath, targetPath: this.target });
      throw onboardingError("The installed FNGK did not match the bundled checksum.", "artifact_install_failed");
    }
    await this.#writeMarker(this.target, bundledVersion ?? "unknown");
    return { ...installed, version: bundledVersion, message: "FNGK bundled with Atlas is installed." };
  }

  async #readMarker(): Promise<Marker | undefined> {
    if (!this.environment.markerPath) return undefined;
    try { return JSON.parse(await readFile(this.environment.markerPath, "utf8")) as Marker; } catch { return undefined; }
  }

  async #writeMarker(target: string, version: string): Promise<void> {
    if (!this.environment.markerPath) return;
    await mkdir(path.dirname(this.environment.markerPath), { recursive: true });
    await writeFile(this.environment.markerPath, `${JSON.stringify({ path: target, sha256: await sha256File(target), version }, null, 2)}\n`);
  }
}

export async function probeVersion(binary: string): Promise<string | undefined> {
  try { return parseVersionOutput((await execFileAsync(binary, ["version"], { timeout: 10_000 })).stdout); } catch { return undefined; }
}

async function sha256File(file: string): Promise<string> { return createHash("sha256").update(await readFile(file)).digest("hex"); }
async function regularFile(value: string): Promise<boolean> { try { return (await stat(value)).isFile(); } catch { return false; } }
function abortIfNeeded(signal?: AbortSignal): void { if (signal?.aborted) throw onboardingError("FNGK installation was cancelled.", "cancelled"); }
function progress(phase: BootstrapProgress["phase"], value: number, message: string): BootstrapProgress {
  return { protocolVersion: BOOTSTRAP_PROTOCOL_VERSION, operationId: "install", state: "checking", phase, progress: value, message };
}
function result(state: InstallResult["state"], message: string, extra: Partial<InstallResult> = {}): InstallResult {
  return { protocolVersion: BOOTSTRAP_PROTOCOL_VERSION, state, message, ...extra };
}

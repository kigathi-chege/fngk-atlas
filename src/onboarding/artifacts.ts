import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import {
  BOOTSTRAP_PROTOCOL_VERSION,
  isFngkArchitecture,
  isFngkPlatform,
  isValidInstallManifest,
  type FngkArchitecture,
  type FngkPlatform,
  type InstallArtifact,
  type InstallManifest,
} from "./types.js";

export interface LocalFngkCandidate {
  path: string;
  source: "bundled" | "configured" | "path";
  compatible?: boolean;
}

export interface LocateFngkOptions {
  bundledPath?: string;
  configuredPath?: string;
  pathEntries?: string[];
  probe?: (candidate: LocalFngkCandidate) => Promise<{ compatible: boolean }>;
}

export interface VerifiedArtifact {
  protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
  artifact: InstallArtifact;
  archive: Buffer;
  platform: FngkPlatform;
  architecture: FngkArchitecture;
}

export interface VerifyArtifactOptions {
  verifySignature?: (payload: Buffer, signature: string) => Promise<boolean>;
  maxBytes?: number;
}

const defaultMaxBytes = 128 * 1024 * 1024;

export async function locateFngk(options: LocateFngkOptions = {}): Promise<LocalFngkCandidate[]> {
  const entries: LocalFngkCandidate[] = [
    ...(options.bundledPath ? [{ path: options.bundledPath, source: "bundled" as const }] : []),
    ...(options.configuredPath ? [{ path: options.configuredPath, source: "configured" as const }] : []),
    ...(options.pathEntries ?? process.env.PATH?.split(path.delimiter).map(directory => path.join(directory, process.platform === "win32" ? "fngk.exe" : "fngk")) ?? []).map(value => ({ path: value, source: "path" as const })),
  ];
  const found: LocalFngkCandidate[] = [];
  const seen = new Set<string>();
  for (const candidate of entries) {
    const resolved = path.resolve(candidate.path);
    if (seen.has(resolved) || !(await executable(resolved))) continue;
    seen.add(resolved);
    const checked = { ...candidate, path: resolved };
    const status = options.probe ? await options.probe(checked).catch(() => ({ compatible: false })) : undefined;
    if (status && !status.compatible) continue;
    found.push({ ...checked, compatible: status?.compatible });
  }
  return found;
}

export async function downloadFngkArtifact(url: string, options: { maxBytes?: number; timeoutMs?: number; fetcher?: typeof fetch } = {}): Promise<Buffer> {
  let target: URL;
  try { target = new URL(url); } catch { throw onboardingError("FNGK artifact URL is invalid.", "artifact_url_invalid"); }
  if (target.protocol !== "https:") throw onboardingError("FNGK artifacts must use HTTPS.", "artifact_url_invalid");
  const maximum = options.maxBytes ?? defaultMaxBytes, controller = new AbortController(), timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const response = await (options.fetcher ?? fetch)(target, { redirect: "error", signal: controller.signal });
    if (!response.ok || !response.body) throw onboardingError("FNGK artifact download failed.", "artifact_download_failed");
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maximum) throw onboardingError("FNGK artifact exceeds the allowed size.", "artifact_size_exceeded");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const next = await reader.read(); if (next.done) break;
      length += next.value.byteLength;
      if (length > maximum) { await reader.cancel(); throw onboardingError("FNGK artifact exceeds the allowed size.", "artifact_size_exceeded"); }
      chunks.push(next.value);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    if ((error as Error).name === "AbortError") throw onboardingError("FNGK artifact download timed out.", "artifact_download_timeout");
    throw error;
  } finally { clearTimeout(timeout); }
}

export async function verifyFngkArtifact(manifest: InstallManifest, archive: Buffer, platform: FngkPlatform, architecture: FngkArchitecture, options: VerifyArtifactOptions = {}): Promise<VerifiedArtifact> {
  if (!isFngkPlatform(platform) || !isFngkArchitecture(architecture) || !isValidInstallManifest(manifest, platform, architecture)) throw onboardingError("No matching FNGK artifact is available for this platform.", "artifact_architecture_unsupported");
  const artifact = manifest.artifacts.find(item => item.platform === platform && item.architecture === architecture)!;
  const maximum = options.maxBytes ?? defaultMaxBytes;
  if (archive.byteLength !== artifact.bytes) throw onboardingError("FNGK artifact size does not match its manifest.", "artifact_size_mismatch");
  if (archive.byteLength > maximum) throw onboardingError("FNGK artifact exceeds the allowed size.", "artifact_size_exceeded");
  if (createHash("sha256").update(archive).digest("hex") !== artifact.sha256.toLowerCase()) throw onboardingError("FNGK artifact checksum does not match its manifest.", "artifact_checksum_mismatch");
  if (!options.verifySignature || !(await options.verifySignature(manifestSigningPayload(manifest, artifact), artifact.signature))) throw onboardingError("FNGK artifact signature could not be verified.", "artifact_signature_invalid");
  return { protocolVersion: BOOTSTRAP_PROTOCOL_VERSION, artifact, archive, platform, architecture };
}

export function manifestSigningPayload(manifest: InstallManifest, artifact: InstallArtifact): Buffer {
  return Buffer.from(JSON.stringify({ protocolVersion: manifest.protocolVersion, version: manifest.version, platform: artifact.platform, architecture: artifact.architecture, url: artifact.url, sha256: artifact.sha256, bytes: artifact.bytes }));
}

async function executable(candidate: string): Promise<boolean> {
  try { await access(candidate, constants.X_OK); return true; } catch { return false; }
}

export function onboardingError(message: string, code: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

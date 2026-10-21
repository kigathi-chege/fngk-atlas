import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { downloadFngkArtifact, manifestSigningPayload, onboardingError } from "./artifacts.js";
import { isValidInstallManifest, type FngkArchitecture, type FngkPlatform, type InstallArtifact, type InstallManifest } from "./types.js";

/** Where Atlas looks for FNGK updates. Signal's release workflow publishes it. */
export const DEFAULT_FNGK_MANIFEST_URL = "https://downloads.signol.org/fngk/latest.json";

/**
 * Pinned Ed25519 public keys allowed to sign `fngk/latest.json`, as SPKI PEM
 * (or base64 of the raw 32-byte key). The private half is the
 * `FNGK_MANIFEST_SIGNING_KEY` secret in NIPATEAFRICA/signal. More than one
 * entry allows a rotation: ship the new key next to the old one, switch the
 * secret, then drop the old key (docs/release-and-signing.md).
 */
export const PINNED_FNGK_MANIFEST_KEYS: readonly string[] = [
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEANXYSaWqiLayYy9a6cMlCnxkjQ3vmno2QnI6rM732P0w=\n-----END PUBLIC KEY-----",
];

/**
 * Keys in effect. `ATLAS_FNGK_MANIFEST_PUBLIC_KEY` (`;`-separated) replaces the
 * pinned list for development with the dev keys in `.devlocal/keys`. A packaged
 * release always runs with the pinned keys: its desktop host sets this variable
 * itself (empty unless the build staged a dev key, which release CI refuses).
 */
export function manifestPublicKeys(env: NodeJS.ProcessEnv = process.env): string[] {
  const override = env.ATLAS_FNGK_MANIFEST_PUBLIC_KEY?.split(";").map(value => value.trim()).filter(Boolean);
  return override?.length ? override : [...PINNED_FNGK_MANIFEST_KEYS];
}

export function ed25519PublicKey(value: string): KeyObject {
  const text = value.trim();
  let key: KeyObject;
  try {
    if (text.startsWith("-----BEGIN")) key = createPublicKey(text);
    else {
      const bytes = Buffer.from(text, "base64");
      if (bytes.length !== 32) throw new Error("length");
      key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: bytes.toString("base64url") }, format: "jwk" });
    }
  } catch { throw onboardingError("FNGK manifest public key must be an Ed25519 SPKI PEM or base64 raw key.", "manifest_key_invalid"); }
  if (key.asymmetricKeyType !== "ed25519") throw onboardingError("FNGK manifest public key is not Ed25519.", "manifest_key_invalid");
  return key;
}

/** Builds the `verifySignature` hook used by `verifyFngkArtifact`. */
export function createSignatureVerifier(publicKeys: readonly string[]): (payload: Buffer, signature: string) => Promise<boolean> {
  const keys = publicKeys.map(ed25519PublicKey);
  return async (payload, signature) => {
    const bytes = Buffer.from(signature, "base64");
    if (bytes.length !== 64) return false;
    return keys.some(key => verify(null, payload, key, bytes));
  };
}

export interface TrustedManifest { manifest: InstallManifest; artifact: InstallArtifact }

/** Downloads `latest.json`, validates its shape, and verifies this platform's artifact signature. */
export async function fetchTrustedManifest(url: string, platform: FngkPlatform, architecture: FngkArchitecture, options: { publicKeys: readonly string[]; fetcher?: typeof fetch; timeoutMs?: number }): Promise<TrustedManifest> {
  if (!options.publicKeys.length) throw onboardingError("No FNGK manifest signing key is pinned in this Atlas build.", "manifest_key_unpinned");
  const raw = await downloadFngkArtifact(url, { maxBytes: 256 * 1024, timeoutMs: options.timeoutMs ?? 15_000, fetcher: options.fetcher });
  let manifest: unknown;
  try { manifest = JSON.parse(raw.toString("utf8")); } catch { throw onboardingError("FNGK manifest is not valid JSON.", "manifest_invalid"); }
  if (!isValidInstallManifest(manifest, platform, architecture)) throw onboardingError("No matching FNGK artifact is available for this platform.", "artifact_architecture_unsupported");
  const artifact = manifest.artifacts.find(item => item.platform === platform && item.architecture === architecture)!;
  if (!(await createSignatureVerifier(options.publicKeys)(manifestSigningPayload(manifest, artifact), artifact.signature))) throw onboardingError("FNGK manifest signature could not be verified.", "artifact_signature_invalid");
  return { manifest, artifact };
}

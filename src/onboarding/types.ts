export const BOOTSTRAP_PROTOCOL_VERSION = "atlas.desktop-bootstrap.v1" as const;

export type BootstrapState =
  | "checking"
  | "install-choice"
  | "update-choice"
  | "daemon-install-choice"
  | "login-choice"
  | "ready"
  | "recoverable-error";

export type FngkPlatform = "linux" | "darwin" | "win32";
export type FngkArchitecture = "x64" | "arm64";

export interface FngkLocalStatus {
  protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
  state: BootstrapState;
  message: string;
  errorCode?: string;
  executable?: string;
  version?: string;
  profile?: string;
  daemon?: "reachable" | "unavailable" | "unknown";
  authenticated?: boolean;
  namespaceProtocol?: string;
  terminalProtocol?: string;
}

export interface FngkRemoteStatus {
  id: string;
  label: string;
  online: boolean;
  compatible: boolean;
  lastObservedAt?: string;
}

export interface BootstrapProgress {
  protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
  operationId: string;
  state: BootstrapState;
  phase: "checking" | "downloading" | "verifying" | "installing" | "converging" | "authorizing" | "complete" | "failed";
  progress: number;
  message: string;
  errorCode?: string;
}

export interface AuthCallback {
  stateId: string;
  origin: string;
  receivedAt: string;
  code?: string;
}

export interface InstallArtifact {
  platform: FngkPlatform;
  architecture: FngkArchitecture;
  url: string;
  sha256: string;
  signature: string;
  bytes: number;
}

export interface InstallManifest {
  protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
  version: string;
  artifacts: InstallArtifact[];
}

export interface InstallResult {
  protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
  state: BootstrapState;
  message: string;
  errorCode?: string;
  installedPath?: string;
  version?: string;
  rolledBack?: boolean;
}

const transitionMap: Record<BootstrapState, readonly BootstrapState[]> = {
  checking: ["install-choice", "update-choice", "daemon-install-choice", "login-choice", "ready", "recoverable-error"],
  "install-choice": ["checking", "recoverable-error"],
  "update-choice": ["checking", "recoverable-error"],
  "daemon-install-choice": ["checking", "recoverable-error"],
  "login-choice": ["checking", "ready", "recoverable-error"],
  ready: ["checking", "recoverable-error"],
  "recoverable-error": ["checking"],
};

const sensitiveMessage = /(?:credential|password|secret|token|cookie|authorization\s*:\s*bearer)/i;

export function bootstrapTransition(from: BootstrapState, to: BootstrapState): boolean {
  return transitionMap[from].includes(to);
}

export function isSafeBootstrapMessage(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 480 && !sensitiveMessage.test(value);
}

export function isBootstrapState(value: unknown): value is BootstrapState {
  return typeof value === "string" && Object.hasOwn(transitionMap, value);
}

export function isFngkPlatform(value: unknown): value is FngkPlatform {
  return value === "linux" || value === "darwin" || value === "win32";
}

export function isFngkArchitecture(value: unknown): value is FngkArchitecture {
  return value === "x64" || value === "arm64";
}

export function isValidInstallManifest(
  value: unknown,
  platform: FngkPlatform,
  architecture: FngkArchitecture,
): value is InstallManifest {
  if (!isRecordWithOnly(value, ["protocolVersion", "version", "artifacts"])) return false;
  if (value.protocolVersion !== BOOTSTRAP_PROTOCOL_VERSION || typeof value.version !== "string" || value.version.length === 0 || !Array.isArray(value.artifacts)) return false;
  return value.artifacts.some((artifact) => isValidArtifact(artifact, platform, architecture));
}

function isValidArtifact(value: unknown, platform: FngkPlatform, architecture: FngkArchitecture): value is InstallArtifact {
  if (!isRecordWithOnly(value, ["platform", "architecture", "url", "sha256", "signature", "bytes"])) return false;
  return value.platform === platform && value.architecture === architecture && typeof value.url === "string" && /^https:\/\//.test(value.url) && /^[a-f0-9]{64}$/i.test(String(value.sha256)) && typeof value.signature === "string" && value.signature.length > 0 && typeof value.bytes === "number" && Number.isSafeInteger(value.bytes) && value.bytes > 0;
}

export function isRecordWithOnly(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
}

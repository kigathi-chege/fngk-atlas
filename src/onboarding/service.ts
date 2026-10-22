import type { FngkContextState, FngkProfileSummary } from "../fngk/process-client.js";
import { onboardingError } from "./artifacts.js";
import {
  BOOTSTRAP_PROTOCOL_VERSION,
  type BootstrapProgress,
  type BootstrapState,
  type FngkLocalStatus,
  type InstallResult,
} from "./types.js";

export interface BootstrapSnapshot {
  protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
  state: BootstrapState;
  local: FngkLocalStatus;
  updatedAt: string;
}

export interface LocalFngkRuntime {
  probe(profile?: string, signal?: AbortSignal): Promise<FngkContextState>;
  install(profile: string, signal?: AbortSignal): Promise<void>;
  /** Credential-free profile metadata (`fngk profiles --json`), when available. */
  profiles?(signal?: AbortSignal): Promise<{ profiles: FngkProfileSummary[] }>;
}

export interface BootstrapServiceDependencies extends LocalFngkRuntime {
  installBinary?: (scope: "user" | "system", emit: (event: BootstrapProgress) => void, signal?: AbortSignal) => Promise<InstallResult>;
  delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

export class BootstrapService {
  readonly #profile: string;
  readonly #timeoutMs: number;
  readonly #pollMs: number;
  readonly #delay: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly #now: () => number;
  #snapshot?: BootstrapSnapshot;

  constructor(readonly runtime: BootstrapServiceDependencies, options: { profile?: string; timeoutMs?: number; pollMs?: number } = {}) {
    this.#profile = options.profile ?? "local";
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    this.#pollMs = options.pollMs ?? 500;
    this.#delay = runtime.delay ?? wait;
    this.#now = runtime.now ?? Date.now;
  }

  /**
   * The profile onboarding works on when Atlas has not selected one: the FNGK
   * current profile if there is one, otherwise the configured default.
   */
  async resolveProfile(signal?: AbortSignal): Promise<string> {
    const profiles = await this.#profiles(signal);
    return profiles?.find(profile => profile.current)?.name ?? this.#profile;
  }

  async check(profileOrSignal?: string | AbortSignal, signal?: AbortSignal): Promise<BootstrapSnapshot> {
    const { profile, signal: effectiveSignal } = bootstrapCheckOptions(this.#profile, profileOrSignal, signal);
    ensureProfile(profile);
    abortIfNeeded(effectiveSignal);
    const [runtime, profiles] = await Promise.all([this.runtime.probe(profile, effectiveSignal), this.#profiles(effectiveSignal)]);
    const summary = profiles?.find(item => item.name === profile);
    const state = bootstrapState(runtime, summary, profiles !== undefined);
    const local: FngkLocalStatus = {
      protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
      state,
      message: localMessage(state),
      ...(runtime.reason ? { errorCode: safeErrorCode(runtime.reason) } : {}),
      ...(state === "recoverable-error" && runtime.detail ? { detail: runtime.detail } : {}),
      ...(runtime.binary ? { executable: runtime.binary } : {}),
      ...(runtime.version ? { version: runtime.version } : {}),
      ...(runtime.profile ? { profile: runtime.profile } : {}),
      daemon: runtime.daemon === "reachable" ? "reachable" : runtime.daemon === "unknown" ? "unknown" : "unavailable",
      authenticated: runtime.login === "authenticated",
      ...(runtime.namespaceProtocol ? { namespaceProtocol: runtime.namespaceProtocol } : {}),
      ...(runtime.terminalProtocol ? { terminalProtocol: runtime.terminalProtocol } : {}),
      ...(summary ? { operatorAuthorized: summary.operatorAuthorized, devicePaired: summary.paired && summary.mode === "device", deviceDaemon: summary.daemon, ...(summary.operatorAccount ? { account: summary.operatorAccount } : {}) } : {}),
    };
    if (!local.profile) local.profile = profile;
    return this.#snapshot = { protocolVersion: BOOTSTRAP_PROTOCOL_VERSION, state, local, updatedAt: new Date(this.#now()).toISOString() };
  }

  async *install(scope: "user" | "system", signal?: AbortSignal): AsyncIterable<BootstrapProgress> {
    abortIfNeeded(signal);
    if (!this.runtime.installBinary) throw onboardingError("No signed FNGK installer is configured.", "installer_unconfigured");
    const events: BootstrapProgress[] = [];
    const result = await this.runtime.installBinary(scope, event => events.push(redactedProgress(event)), signal);
    for (const event of events) yield event;
    if (result.state === "recoverable-error") throw onboardingError(result.message, result.errorCode ?? "installation_failed");
    // Converge only once the binary is in place, and only when a paired profile
    // is waiting for its daemon; an unpaired install stops at sign-in.
    const snapshot = await this.check(this.#profile, signal);
    if (snapshot.state === "install-choice") throw onboardingError("FNGK is still unavailable after installation.", "installation_failed");
    if (snapshot.state === "daemon-install-choice") { yield* this.converge(this.#profile, signal); return; }
    yield this.#progress("complete", 100, snapshot.local.message, snapshot.state);
  }

  async *converge(profile = this.#profile, signal?: AbortSignal): AsyncIterable<BootstrapProgress> {
    ensureProfile(profile); abortIfNeeded(signal);
    yield this.#progress("converging", 5, "Starting the FNGK daemon.");
    await this.runtime.install(profile, signal);
    const deadline = this.#now() + this.#timeoutMs;
    while (true) {
      abortIfNeeded(signal);
      const snapshot = await this.check(profile, signal);
      if (snapshot.state === "ready") { yield this.#progress("complete", 100, "FNGK is ready.", "ready"); return; }
      if (this.#now() >= deadline) throw onboardingError("FNGK did not become ready before the deadline.", "bootstrap_timeout");
      yield this.#progress("converging", 40, "Waiting for the FNGK daemon.", snapshot.state);
      await this.#delay(this.#pollMs, signal);
    }
  }

  async *repair(profileOrSignal?: string | AbortSignal, signal?: AbortSignal): AsyncIterable<BootstrapProgress> {
    const { profile, signal: effectiveSignal } = bootstrapCheckOptions(this.#profile, profileOrSignal, signal);
    const snapshot = await this.check(profile, effectiveSignal);
    if (snapshot.state === "daemon-install-choice" || snapshot.state === "recoverable-error") { yield* this.converge(profile, effectiveSignal); return; }
    yield this.#progress("complete", 100, snapshot.local.message, snapshot.state);
  }

  snapshot(): BootstrapSnapshot | undefined { return this.#snapshot; }

  async #profiles(signal?: AbortSignal): Promise<FngkProfileSummary[] | undefined> {
    if (!this.runtime.profiles) return undefined;
    try { return (await this.runtime.profiles(signal)).profiles; } catch { return undefined; }
  }

  #progress(phase: BootstrapProgress["phase"], progress: number, message: string, state: BootstrapState = "checking"): BootstrapProgress {
    return { protocolVersion: BOOTSTRAP_PROTOCOL_VERSION, operationId: "bootstrap", state, phase, progress, message };
  }
}

function bootstrapState(runtime: FngkContextState, profile: FngkProfileSummary | undefined, profilesKnown: boolean): BootstrapState {
  if (!runtime.installed || runtime.reason === "binary_missing") return "install-choice";
  if (runtime.reason === "unsupported_protocol" || (runtime.compatible === false && runtime.reason === "protocol_incompatible")) return "update-choice";
  if (runtime.reason === "daemon_unavailable") return "daemon-install-choice";
  if (runtime.login === "required" || runtime.reason === "authentication_required" || runtime.reason === "profile_missing") return "login-choice";
  // The profile metadata knows a missing operator login even when the namespace error is generic.
  if (!runtime.compatible && profilesKnown && (!profile || !profile.operatorAuthorized)) return "login-choice";
  if (runtime.compatible && runtime.daemon === "reachable" && runtime.login === "authenticated") {
    // Signed in and this machine is a paired Device whose daemon is not running yet.
    if (profile?.mode === "device" && profile.paired && profile.daemon === "stopped") return "daemon-install-choice";
    return "ready";
  }
  return "recoverable-error";
}

function localMessage(state: BootstrapState): string {
  return ({ checking: "Checking FNGK.", "install-choice": "FNGK needs to be installed.", "update-choice": "FNGK needs a compatible update.", "daemon-install-choice": "FNGK needs its local daemon.", "login-choice": "Sign in to Signal.", ready: "FNGK is ready.", "recoverable-error": "FNGK needs attention." })[state];
}

function safeErrorCode(value: string): string | undefined { return /^[a-z0-9_]{1,96}$/i.test(value) ? value : undefined; }
function ensureProfile(value: string): void { if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw onboardingError("FNGK profile is invalid.", "profile_invalid"); }
function bootstrapCheckOptions(defaultProfile: string, profileOrSignal?: string | AbortSignal, signal?: AbortSignal): { profile: string; signal?: AbortSignal } {
  return typeof profileOrSignal === "string" ? { profile: profileOrSignal, signal } : { profile: defaultProfile, signal: profileOrSignal };
}
function abortIfNeeded(signal?: AbortSignal): void { if (signal?.aborted) throw onboardingError("FNGK bootstrap was cancelled.", "cancelled"); }
function redactedProgress(event: BootstrapProgress): BootstrapProgress { return { ...event, message: event.message.replace(/(?:credential|password|secret|token|cookie)\s*[:=]\s*\S+/ig, "[redacted]").slice(0, 480) }; }
function wait(milliseconds: number, signal?: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { const timer = setTimeout(resolve, milliseconds); const abort = () => { clearTimeout(timer); reject(onboardingError("FNGK bootstrap was cancelled.", "cancelled")); }; if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true }); }); }

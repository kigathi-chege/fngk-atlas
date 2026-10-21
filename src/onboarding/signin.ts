import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { onboardingError } from "./artifacts.js";
import { normalizeSignalUrl } from "./signal-url.js";

// One-step "Sign in to Signal" for Atlas. It drives `fngk login --pair --json`,
// which opens a browser approval that both signs the user in as an operator
// and pairs this machine as a Device in the same FNGK profile. Atlas never
// sees a credential: it relays the authorization link and code, and follows
// the fngk.login.v1 events until the CLI has stored both.

export interface LoginProcess {
  events: AsyncIterable<unknown>;
  /** Resolves on exit 0; rejects with the (bounded) stderr tail otherwise. */
  done: Promise<void>;
  cancel(): void;
}

export interface LoginLauncher { start(args: string[]): LoginProcess; }

export type SignInState = "waiting" | "authenticated" | "complete" | "failed" | "cancelled";

export interface SignInView {
  id: string;
  profile: string;
  signalUrl: string;
  authorizationUrl: string;
  userCode?: string;
  expiresAt: string;
  state: SignInState;
  /** Whether this Signal will also pair the Device (false on an older Signal). */
  pairing: boolean;
  account?: string;
  device?: { state: "paired" | "unavailable"; alreadyPaired?: boolean; name?: string };
  error?: { code: string; message: string };
}

interface Session { view: SignInView; process: LoginProcess; }

const PROFILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const STATE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export class SignInService {
  #sessions = new Map<string, Session>();
  readonly #now: () => number;
  readonly #firstEventTimeoutMs: number;

  constructor(readonly launcher: LoginLauncher, options: { now?: () => number; firstEventTimeoutMs?: number } = {}) {
    this.#now = options.now ?? Date.now;
    this.#firstEventTimeoutMs = options.firstEventTimeoutMs ?? 20_000;
  }

  async begin(input: { profile: string; signalUrl?: string; deviceName?: string; returnTo?: string }): Promise<SignInView> {
    if (!PROFILE.test(input.profile)) throw onboardingError("FNGK profile is invalid.", "profile_invalid");
    let explicit: string | undefined;
    if (input.signalUrl !== undefined && input.signalUrl !== "") {
      explicit = normalizeSignalUrl(input.signalUrl) ?? undefined;
      if (!explicit) throw onboardingError("Use the HTTPS address of your Signal.", "signal_url_invalid");
    }
    if (input.deviceName !== undefined && (typeof input.deviceName !== "string" || !input.deviceName.trim() || input.deviceName.length > 100 || /[\u0000-\u001f]/.test(input.deviceName))) throw onboardingError("The Device name must be one line of at most 100 characters.", "device_name_invalid");
    // One sign-in at a time: a new attempt replaces a stale one.
    for (const id of [...this.#sessions.keys()]) await this.cancel(id);
    const args = ["login", ...(explicit ? [explicit] : []), "--profile", input.profile, "--pair", "--json", "--client", "FNGK Atlas"];
    if (input.deviceName) args.push("--device-name", input.deviceName.trim());
    if (input.returnTo) args.push("--return-to", input.returnTo);
    const login = this.launcher.start(args);
    const iterator = login.events[Symbol.asyncIterator]();
    let first: IteratorResult<unknown>;
    try {
      first = await withTimeout(iterator.next(), this.#firstEventTimeoutMs);
    } catch (error) {
      login.cancel();
      throw startFailure(error, explicit === undefined);
    }
    if (first.done) {
      const failure = await login.done.then(() => undefined, (error: unknown) => error);
      throw startFailure(failure, explicit === undefined);
    }
    let view: SignInView;
    try { view = parseStart(first.value, input.profile, explicit, this.#now()); }
    catch (error) { login.cancel(); throw error; }
    const session: Session = { view, process: login };
    this.#sessions.set(view.id, session);
    void this.#follow(session, iterator);
    return { ...view };
  }

  get(id: string): SignInView | undefined {
    const session = this.#sessions.get(id);
    if (!session) return undefined;
    if (session.view.state === "waiting" && this.#now() >= Date.parse(session.view.expiresAt)) {
      session.process.cancel();
      session.view = { ...session.view, state: "failed", error: { code: "authorization_expired", message: "The sign-in request expired. Start again." } };
    }
    return { ...session.view };
  }

  authorizationUrl(id: string): string | undefined { return this.#sessions.get(id)?.view.authorizationUrl; }

  async cancel(id: string): Promise<boolean> {
    const session = this.#sessions.get(id);
    if (!session) return false;
    this.#sessions.delete(id);
    if (session.view.state === "waiting" || session.view.state === "authenticated") {
      session.view = { ...session.view, state: "cancelled" };
      session.process.cancel();
      await session.process.done.catch(() => {});
    }
    return true;
  }

  async close(): Promise<void> { for (const id of [...this.#sessions.keys()]) await this.cancel(id); }

  async #follow(session: Session, iterator: AsyncIterator<unknown>): Promise<void> {
    const update = (patch: Partial<SignInView>) => { if (session.view.state !== "cancelled") session.view = { ...session.view, ...patch }; };
    try {
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        const event = next.value as Record<string, unknown>;
        if (!event || typeof event !== "object" || event.protocolVersion !== "fngk.login.v1" || event.profile !== session.view.profile) throw onboardingError("FNGK returned an unexpected sign-in event.", "login_protocol_invalid");
        if (event.state === "authenticated") update({ state: "authenticated", ...(typeof event.account === "string" && event.account ? { account: event.account.slice(0, 254) } : {}) });
        else if (event.state === "paired") update({ state: "complete", device: { state: "paired", ...(event.alreadyPaired === true ? { alreadyPaired: true } : {}), ...(typeof event.deviceName === "string" ? { name: event.deviceName.slice(0, 100) } : {}) } });
        else if (event.state === "pairing-unavailable") update({ state: "complete", device: { state: "unavailable" } });
        else throw onboardingError("FNGK returned an unexpected sign-in event.", "login_protocol_invalid");
      }
      await session.process.done;
      if (session.view.state === "authenticated") update({ state: "complete" });
      else if (session.view.state === "waiting") update({ state: "failed", error: { code: "login_protocol_invalid", message: "FNGK ended sign-in without signing in." } });
    } catch (error) {
      await session.process.done.catch(() => {});
      if (session.view.state !== "cancelled" && session.view.state !== "complete") update({ state: "failed", error: loginFailure(error) });
    }
  }
}

function parseStart(value: unknown, profile: string, explicit: string | undefined, now: number): SignInView {
  const event = value as Record<string, unknown>;
  if (!event || typeof event !== "object" || event.protocolVersion !== "fngk.login.v1" || event.state !== "authorization-required" || event.profile !== profile) throw onboardingError("FNGK returned an unsupported sign-in protocol. Update FNGK.", "login_protocol_invalid");
  const signalUrl = normalizeSignalUrl(event.signalUrl);
  if (!signalUrl || (explicit && signalUrl !== explicit)) throw onboardingError("FNGK did not confirm which Signal it is signing in to. Update FNGK.", "login_protocol_invalid");
  let authorization: URL;
  try { authorization = new URL(String(event.authorizationUrl)); } catch { throw onboardingError("FNGK returned an invalid authorization link.", "login_protocol_invalid"); }
  // The browser link must belong to the Signal being signed in to.
  if (authorization.origin !== signalUrl) throw onboardingError("FNGK returned an authorization link for another site.", "authorization_origin_invalid");
  const expiresAt = Date.parse(String(event.expiresAt));
  if (typeof event.stateId !== "string" || !STATE_ID.test(event.stateId) || !Number.isFinite(expiresAt) || expiresAt <= now) throw onboardingError("FNGK returned an invalid authorization request.", "login_protocol_invalid");
  const userCode = typeof event.userCode === "string" && /^[A-Z0-9-]{4,32}$/.test(event.userCode) ? event.userCode : undefined;
  return { id: randomUUID(), profile, signalUrl, authorizationUrl: authorization.toString(), ...(userCode ? { userCode } : {}), expiresAt: new Date(expiresAt).toISOString(), state: "waiting", pairing: event.pairing === true };
}

function stderrOf(error: unknown): string { return String((error as { stderr?: string })?.stderr ?? (error as Error)?.message ?? ""); }

function startFailure(error: unknown, usedDefaultUrl: boolean): Error {
  if ((error as { code?: string })?.code === "timeout") return onboardingError("FNGK did not start sign-in in time.", "login_timeout");
  const stderr = stderrOf(error);
  // An FNGK older than `login --pair` reads the first flag as a Signal URL.
  if (/unknown login option|invalid Signal URL/i.test(stderr) && usedDefaultUrl) return onboardingError("Update FNGK to sign in from Atlas.", "fngk_update_required");
  if (/invalid Signal URL|unsupported URL scheme/i.test(stderr)) return onboardingError("That Signal address is not valid.", "signal_url_invalid");
  if (/ENOENT|could not start/i.test(stderr)) return onboardingError("FNGK is not installed.", "binary_missing");
  if (/connection refused|no such host|dial tcp|timeout/i.test(stderr)) return onboardingError("Atlas could not reach Signal. Check the address and your connection.", "signal_unreachable");
  return onboardingError("FNGK could not start sign-in.", "login_process_failed");
}

function loginFailure(error: unknown): { code: string; message: string } {
  const code = (error as { code?: string })?.code;
  if (code === "login_protocol_invalid") return { code, message: (error as Error).message };
  const stderr = stderrOf(error);
  if (/authorization_denied/.test(stderr)) return { code: "authorization_denied", message: "Sign-in was denied in the browser." };
  if (/expired_token|timed out/.test(stderr)) return { code: "authorization_expired", message: "The sign-in request expired. Start again." };
  if (/pairing failed/.test(stderr)) return { code: "pairing_failed", message: "You are signed in, but this machine could not be added as a Device. Try again." };
  return { code: "login_failed", message: "Sign-in did not complete. Try again." };
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "timeout" })), milliseconds);
    timer.unref?.();
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

/** Spawns the real fngk, splitting stdout into JSON lines and keeping a bounded stderr tail. */
export function createFngkLoginLauncher(binary: string, env: NodeJS.ProcessEnv = process.env): LoginLauncher {
  return { start(args) {
    const child = spawn(binary, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    const queue = new JsonLineQueue();
    let buffered = "", stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => { buffered += chunk; const lines = buffered.split(/\r?\n/); buffered = lines.pop() ?? ""; for (const line of lines) if (line.trim()) queue.push(line); });
    child.stdout.on("end", () => { if (buffered.trim()) queue.push(buffered); });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-4096); });
    const done = new Promise<void>((resolve, reject) => {
      child.once("error", error => { const failure = Object.assign(onboardingError("FNGK login could not start.", "login_process_failed"), { stderr: `could not start: ${(error as NodeJS.ErrnoException).code ?? ""}` }); queue.fail(failure); reject(failure); });
      child.once("close", code => { if (code === 0) { queue.close(); resolve(); } else { const failure = Object.assign(onboardingError("FNGK login did not complete.", "login_process_failed"), { stderr }); queue.fail(failure); reject(failure); } });
    });
    done.catch(() => {});
    return { events: queue, done, cancel: () => { if (child.exitCode === null) child.kill("SIGTERM"); } };
  } };
}

class JsonLineQueue implements AsyncIterable<unknown> {
  #values: unknown[] = [];
  #waiting: Array<{ resolve: (value: IteratorResult<unknown>) => void; reject: (error: Error) => void }> = [];
  #error?: Error;
  #closed = false;
  push(line: string): void {
    let value: unknown;
    try { value = JSON.parse(line); } catch { this.fail(onboardingError("FNGK emitted invalid sign-in JSON.", "login_protocol_invalid")); return; }
    const next = this.#waiting.shift(); if (next) next.resolve({ done: false, value }); else this.#values.push(value);
  }
  close(): void { this.#closed = true; while (this.#waiting.length) this.#waiting.shift()!.resolve({ done: true, value: undefined }); }
  fail(error: Error): void { if (!this.#error) this.#error = error; while (this.#waiting.length) this.#waiting.shift()!.reject(error); }
  [Symbol.asyncIterator](): AsyncIterator<unknown> { return { next: () => {
    if (this.#values.length) return Promise.resolve({ done: false, value: this.#values.shift() });
    if (this.#error) return Promise.reject(this.#error);
    if (this.#closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => this.#waiting.push({ resolve, reject }));
  } }; }
}

import { spawn } from "node:child_process";
import { onboardingError } from "./artifacts.js";
import type { AuthorizationStart, BrowserAuthorizationRuntime } from "./auth-flow.js";

export interface FngkLoginProcess {
  events: AsyncIterable<unknown>;
  done: Promise<void>;
  cancel(): void;
}

export interface FngkLoginLauncher {
  start(args: string[]): FngkLoginProcess;
}

export function createLocalFngkLoginLauncher(binary: string, env: NodeJS.ProcessEnv = process.env): FngkLoginLauncher {
  return { start(args) {
    const child = spawn(binary, args, { env, stdio: ["ignore", "pipe", "ignore"] });
    const queue = new JsonLineQueue();
    child.stdout.setEncoding("utf8"); let buffered = "";
    child.stdout.on("data", chunk => {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/); buffered = lines.pop() ?? "";
      for (const line of lines) queue.push(line);
    });
    child.stdout.on("end", () => { if (buffered.trim()) queue.push(buffered); });
    const done = new Promise<void>((resolve, reject) => {
      child.once("error", () => { queue.fail(onboardingError("FNGK login could not start.", "login_process_failed")); reject(onboardingError("FNGK login could not start.", "login_process_failed")); });
      child.once("close", code => { if (code === 0) { queue.close(); resolve(); } else { const error = onboardingError("FNGK login did not complete.", "login_process_failed"); queue.fail(error); reject(error); } });
    });
    return { events: queue, done, cancel: () => child.kill("SIGTERM") };
  } };
}

interface PendingLogin { process: FngkLoginProcess; completion: Promise<{ profile: string; authenticated: true }>; }

export class FngkBrowserAuthorizationRuntime implements BrowserAuthorizationRuntime {
  #pending = new Map<string, PendingLogin>();

  constructor(readonly launcher: FngkLoginLauncher, readonly binary: string, readonly origin: string) {}

  async begin(profile: string): Promise<AuthorizationStart> {
    const process = this.launcher.start(["login", this.origin, "--profile", profile, "--json"]);
    const iterator = process.events[Symbol.asyncIterator](), first = await iterator.next();
    if (first.done) throw onboardingError("FNGK login ended before it returned an authorization request.", "login_protocol_invalid");
    const start = parseAuthorizationStart(first.value, profile);
    if (this.#pending.has(start.stateId)) { process.cancel(); throw onboardingError("FNGK returned a duplicate authorization state.", "login_protocol_invalid"); }
    this.#pending.set(start.stateId, { process, completion: completeLogin(iterator, process.done, profile) });
    return start;
  }

  async complete(input: { stateId: string; code?: string }): Promise<{ profile: string; authenticated: true }> {
    const pending = this.#pending.get(input.stateId);
    if (!pending) throw onboardingError("FNGK authorization state is unavailable.", "authorization_state_invalid");
    try { return await pending.completion; } finally { this.#pending.delete(input.stateId); }
  }

  async cancel(stateId: string): Promise<void> {
    const pending = this.#pending.get(stateId);
    if (!pending) return;
    this.#pending.delete(stateId); pending.process.cancel(); await pending.process.done.catch(() => {});
  }
}

async function completeLogin(iterator: AsyncIterator<unknown>, done: Promise<void>, profile: string): Promise<{ profile: string; authenticated: true }> {
  const next = await iterator.next();
  if (next.done) { await done; throw onboardingError("FNGK login ended without authentication.", "login_protocol_invalid"); }
  const event = parseAuthenticated(next.value, profile);
  await done;
  return event;
}

function parseAuthorizationStart(value: unknown, profile: string): AuthorizationStart {
  if (!recordWithOnly(value, ["protocolVersion", "state", "authorizationUrl", "stateId", "expiresAt", "profile"]) || value.protocolVersion !== "fngk.login.v1" || value.state !== "authorization-required" || value.profile !== profile || typeof value.authorizationUrl !== "string" || typeof value.stateId !== "string" || typeof value.expiresAt !== "string") throw onboardingError("FNGK returned an unsupported login protocol.", "login_protocol_invalid");
  let url: URL; try { url = new URL(value.authorizationUrl); } catch { throw onboardingError("FNGK returned an invalid authorization URL.", "login_protocol_invalid"); }
  if (url.protocol !== "https:" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value.stateId) || !Number.isFinite(Date.parse(value.expiresAt))) throw onboardingError("FNGK returned an invalid authorization request.", "login_protocol_invalid");
  return { authorizationUrl: url.toString(), stateId: value.stateId, expiresAt: new Date(Date.parse(value.expiresAt)).toISOString(), profile };
}

function parseAuthenticated(value: unknown, profile: string): { profile: string; authenticated: true } {
  if (!recordWithOnly(value, ["protocolVersion", "state", "profile"]) || value.protocolVersion !== "fngk.login.v1" || value.state !== "authenticated" || value.profile !== profile) throw onboardingError("FNGK did not return an authenticated login event.", "login_protocol_invalid");
  return { profile, authenticated: true };
}

function recordWithOnly(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
}

class JsonLineQueue implements AsyncIterable<unknown> {
  #values: unknown[] = [];
  #waiting: Array<(value: IteratorResult<unknown>) => void> = [];
  #error?: Error;
  #closed = false;
  push(line: string): void {
    let value: unknown;
    try { value = JSON.parse(line); } catch { this.fail(onboardingError("FNGK emitted invalid login JSON.", "login_protocol_invalid")); return; }
    const next = this.#waiting.shift(); if (next) next({ done: false, value }); else this.#values.push(value);
  }
  close(): void { this.#closed = true; while (this.#waiting.length) this.#waiting.shift()!({ done: true, value: undefined }); }
  fail(error: Error): void { this.#error = error; while (this.#waiting.length) this.#waiting.shift()!({ done: true, value: undefined }); }
  [Symbol.asyncIterator](): AsyncIterator<unknown> { return { next: () => {
    if (this.#error) return Promise.reject(this.#error);
    const value = this.#values.shift(); if (value !== undefined) return Promise.resolve({ done: false, value });
    if (this.#closed) return Promise.resolve({ done: true, value: undefined });
    return new Promise(resolve => this.#waiting.push(resolve));
  } }; }
}

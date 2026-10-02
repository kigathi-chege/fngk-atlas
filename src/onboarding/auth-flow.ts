import { onboardingError } from "./artifacts.js";
import type { AuthCallback } from "./types.js";

export interface AuthorizationStart {
  authorizationUrl: string;
  stateId: string;
  expiresAt: string;
  profile: string;
}

export interface BrowserAuthorizationRuntime {
  begin(profile: string): Promise<AuthorizationStart>;
  complete(input: { stateId: string; code?: string }): Promise<{ profile: string; authenticated: true }>;
  cancel(stateId: string): Promise<void>;
}

interface PendingAuthorization { profile: string; expiresAt: number; used: boolean; }

export class AuthFlow {
  readonly #origin: string;
  readonly #now: () => number;
  #pending = new Map<string, PendingAuthorization>();
  #consumed = new Set<string>();

  constructor(readonly runtime: BrowserAuthorizationRuntime, options: { origin: string; now?: () => number }) {
    let origin: URL;
    try { origin = new URL(options.origin); } catch { throw new Error("Signal authorization origin is invalid."); }
    if (origin.protocol !== "https:") throw new Error("Signal authorization origin must use HTTPS.");
    this.#origin = origin.origin;
    this.#now = options.now ?? Date.now;
  }

  async beginLogin(profile: string): Promise<Pick<AuthorizationStart, "authorizationUrl" | "stateId" | "expiresAt">> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile)) throw onboardingError("FNGK profile is invalid.", "profile_invalid");
    const start = await this.runtime.begin(profile);
    const expiresAt = Date.parse(start.expiresAt); let url: URL;
    try { url = new URL(start.authorizationUrl); } catch { throw onboardingError("FNGK returned an invalid authorization URL.", "authorization_response_invalid"); }
    if (url.origin !== this.#origin || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(start.stateId) || !Number.isFinite(expiresAt) || expiresAt <= this.#now()) throw onboardingError("FNGK returned an invalid authorization request.", "authorization_response_invalid");
    this.#pending.set(start.stateId, { profile, expiresAt, used: false });
    return { authorizationUrl: url.toString(), stateId: start.stateId, expiresAt: new Date(expiresAt).toISOString() };
  }

  async completeLogin(callback: AuthCallback): Promise<{ profile: string; authenticated: true }> {
    if (!callback || typeof callback.stateId !== "string" || typeof callback.origin !== "string" || !Number.isFinite(Date.parse(callback.receivedAt)) || (callback.code !== undefined && typeof callback.code !== "string")) throw onboardingError("Authorization callback is invalid.", "authorization_callback_invalid");
    if (normalizeOrigin(callback.origin) !== this.#origin) throw onboardingError("Authorization callback came from an unexpected origin.", "authorization_origin_invalid");
    const pending = this.#pending.get(callback.stateId);
    if (!pending) {
      if (this.#consumed.has(callback.stateId)) throw onboardingError("Authorization has already been consumed.", "authorization_replayed");
      throw onboardingError("Authorization state is invalid.", "authorization_state_invalid");
    }
    if (pending.used) throw onboardingError("Authorization has already been consumed.", "authorization_replayed");
    if (this.#now() >= pending.expiresAt || Date.parse(callback.receivedAt) >= pending.expiresAt) { this.#pending.delete(callback.stateId); throw onboardingError("Authorization has expired.", "authorization_expired"); }
    pending.used = true;
    const completed = await this.runtime.complete({ stateId: callback.stateId, ...(callback.code ? { code: callback.code } : {}) });
    if (completed.authenticated !== true || completed.profile !== pending.profile) { pending.used = false; throw onboardingError("FNGK did not complete authorization for the selected profile.", "authorization_completion_invalid"); }
    this.#pending.delete(callback.stateId); this.#consumed.add(callback.stateId);
    return { profile: completed.profile, authenticated: true };
  }

  async cancelLogin(stateId: string): Promise<void> {
    const pending = this.#pending.get(stateId);
    if (!pending) return;
    this.#pending.delete(stateId);
    await this.runtime.cancel(stateId);
  }
}

function normalizeOrigin(value: string): string {
  try { return new URL(value).origin; } catch { return ""; }
}

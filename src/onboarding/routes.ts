import type { FastifyInstance, FastifyReply } from "fastify";
import type { BootstrapService } from "./service.js";
import type { SignInService } from "./signin.js";
import type { BrowserOpener } from "./browser.js";

export interface OnboardingRouteOptions {
  bootstrap: BootstrapService;
  signIn: SignInService;
  fngk: { logoutOperator?(profile: string, signal?: AbortSignal): Promise<void>; pair?(pairingUrl: string, profile: string, signal?: AbortSignal): Promise<void> };
  /** The Atlas-selected profile for this request, if any. */
  profile(): string | undefined;
  defaultSignalUrl: string;
  /** Where Signal's consent page sends the user afterwards (deep link or loopback page). */
  returnTo?: string;
  /** Server-side browser opening; only set for the desktop app on loopback. */
  openBrowser?: BrowserOpener;
  signal(request: { raw: NodeJS.EventEmitter }): AbortSignal;
  failure(reply: FastifyReply, error: unknown): FastifyReply;
}

const PROFILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PAIRING_URL = /^https?:\/\/[^\s/]+\/device-pair\/[A-Za-z0-9_-]{20,128}$/;

function onboardingFailure(reply: FastifyReply, error: unknown, fallback: OnboardingRouteOptions["failure"]) {
  const code = String((error as { code?: string })?.code ?? "");
  const message = String((error as Error)?.message ?? "Onboarding failed.");
  if (["profile_invalid", "signal_url_invalid", "device_name_invalid"].includes(code)) return reply.code(400).send({ error: code, message });
  if (["fngk_update_required", "binary_missing"].includes(code)) return reply.code(409).send({ error: code, message });
  if (["login_protocol_invalid", "authorization_origin_invalid", "login_timeout", "login_process_failed", "signal_unreachable"].includes(code)) return reply.code(502).send({ error: code, message });
  return fallback(reply, error);
}

export function registerOnboardingRoutes(app: FastifyInstance, options: OnboardingRouteOptions): void {
  const { bootstrap, signIn } = options;
  const selectedProfile = async (request: { raw: NodeJS.EventEmitter }, requested?: unknown) => {
    if (typeof requested === "string" && requested) return requested;
    return options.profile() ?? await bootstrap.resolveProfile(options.signal(request));
  };

  app.get("/api/onboarding/status", async (request, reply) => {
    try {
      const snapshot = await bootstrap.check(await selectedProfile(request), options.signal(request));
      return { ...snapshot, signIn: { defaultSignalUrl: options.defaultSignalUrl, opensBrowser: Boolean(options.openBrowser) } };
    } catch (error) { return onboardingFailure(reply, error, options.failure); }
  });

  app.post("/api/onboarding/converge", async (request, reply) => {
    const body = request.body as { profile?: unknown; confirm?: unknown } | undefined;
    if (body?.confirm !== true) return reply.code(409).send({ error: "confirmation_required", message: "FNGK daemon convergence requires confirmation." });
    try {
      const profile = await selectedProfile(request, body.profile), events = [];
      for await (const event of bootstrap.converge(profile, options.signal(request))) events.push(event);
      return { snapshot: bootstrap.snapshot(), events };
    } catch (error) { return onboardingFailure(reply, error, options.failure); }
  });

  // One step: sign in as an operator and add this machine as a Device.
  app.post("/api/onboarding/signin", async (request, reply) => {
    const body = (request.body ?? {}) as { profile?: unknown; signalUrl?: unknown; deviceName?: unknown };
    try {
      const profile = await selectedProfile(request, body.profile);
      const started = await signIn.begin({
        profile,
        ...(typeof body.signalUrl === "string" && body.signalUrl.trim() ? { signalUrl: body.signalUrl.trim() } : {}),
        ...(typeof body.deviceName === "string" && body.deviceName.trim() ? { deviceName: body.deviceName } : {}),
        ...(options.returnTo ? { returnTo: options.returnTo } : {}),
      });
      const browserOpened = options.openBrowser ? await options.openBrowser(started.authorizationUrl) : false;
      return reply.code(201).send({ ...started, browserOpened });
    } catch (error) { return onboardingFailure(reply, error, options.failure); }
  });

  app.get("/api/onboarding/signin/:id", async (request, reply) => {
    const view = signIn.get(String((request.params as { id?: string }).id ?? ""));
    return view ?? reply.code(404).send({ error: "signin_not_found", message: "This sign-in is no longer active." });
  });

  app.post("/api/onboarding/signin/:id/open", async (request, reply) => {
    const url = signIn.authorizationUrl(String((request.params as { id?: string }).id ?? ""));
    if (!url) return reply.code(404).send({ error: "signin_not_found", message: "This sign-in is no longer active." });
    // Never an arbitrary URL: only the stored authorization link for this sign-in.
    return { browserOpened: options.openBrowser ? await options.openBrowser(url) : false, authorizationUrl: url };
  });

  app.post("/api/onboarding/signin/:id/cancel", async (request, reply) => {
    await signIn.cancel(String((request.params as { id?: string }).id ?? ""));
    return reply.code(204).send();
  });

  app.post("/api/onboarding/signout", async (request, reply) => {
    const body = (request.body ?? {}) as { profile?: unknown; confirm?: unknown };
    if (body.confirm !== true) return reply.code(409).send({ error: "confirmation_required", message: "Signing out requires confirmation." });
    if (!options.fngk.logoutOperator) return reply.code(501).send({ error: "signout_unavailable", message: "This FNGK client cannot sign out." });
    try {
      const profile = await selectedProfile(request, body.profile);
      if (!PROFILE.test(profile)) return reply.code(400).send({ error: "profile_invalid", message: "FNGK profile is invalid." });
      await options.fngk.logoutOperator(profile, options.signal(request));
      return { signedOut: true, profile };
    } catch (error) { return onboardingFailure(reply, error, options.failure); }
  });

  // Fallback for a Signal that cannot pair from sign-in: a dashboard pairing URL.
  app.post("/api/onboarding/pair", async (request, reply) => {
    const body = (request.body ?? {}) as { profile?: unknown; pairingUrl?: unknown };
    if (typeof body.pairingUrl !== "string" || !PAIRING_URL.test(body.pairingUrl.trim())) return reply.code(400).send({ error: "pairing_url_invalid", message: "Paste the Device pairing URL from the Signal dashboard." });
    if (!options.fngk.pair) return reply.code(501).send({ error: "pairing_unavailable", message: "This FNGK client cannot pair." });
    try {
      const profile = await selectedProfile(request, body.profile);
      if (!PROFILE.test(profile)) return reply.code(400).send({ error: "profile_invalid", message: "FNGK profile is invalid." });
      await options.fngk.pair(body.pairingUrl.trim(), profile, options.signal(request));
      return { paired: true, profile };
    } catch (error) { return onboardingFailure(reply, error, options.failure); }
  });
}

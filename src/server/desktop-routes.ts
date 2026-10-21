import type { FastifyInstance, FastifyReply } from "fastify";
import type { BootstrapService } from "../onboarding/service.js";
import type { DesktopFngkEnvironment, FngkProvisioner } from "../onboarding/provisioner.js";
import type { BootstrapProgress } from "../onboarding/types.js";

/**
 * Desktop host <-> web UI channel and the FNGK install/update routes.
 *
 * The Tauri host never needs the page to call Tauri IPC: it POSTs native events
 * (deep links, update state) here with the launch capability, and the web UI
 * reads them back like any other Atlas API.
 *
 *   POST /api/desktop/deep-link        {url}  (host) a fngk-atlas:// URL opened Atlas
 *   GET  /api/desktop/deep-links?after=N      (web) deep links with seq > N
 *   POST /api/desktop/update-state     {...}  (host) Atlas self-update status
 *   GET  /api/desktop/info                    (web) versions, FNGK paths, update status
 *   POST /api/onboarding/install       {scope:"user", confirm:true}  install FNGK, then converge
 *   GET  /api/fngk/signed-update                     check the signed FNGK manifest
 *   POST /api/fngk/signed-update              {confirm:true}  download, verify, install (rollback on failure)
 */
export interface DesktopRouteDependencies {
  bootstrap: BootstrapService;
  provisioner: FngkProvisioner;
  environment: DesktopFngkEnvironment;
  profile: () => string;
  processError: (error: unknown) => { statusCode: number; body: Record<string, unknown> };
  signal: (request: { raw: NodeJS.EventEmitter }) => AbortSignal;
}

export interface DeepLinkEvent { seq: number; url: string; receivedAt: string }

const DEEP_LINK_SCHEME = "fngk-atlas:";
const MAX_DEEP_LINKS = 20;
const updateStatuses = new Set(["disabled", "checking", "current", "available", "verified", "installing", "error"]);

export function isDeepLink(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return false;
  try { return new URL(value).protocol === DEEP_LINK_SCHEME; } catch { return false; }
}

export function registerDesktopRoutes(app: FastifyInstance, dependencies: DesktopRouteDependencies): void {
  const { bootstrap, provisioner, environment } = dependencies;
  const deepLinks: DeepLinkEvent[] = [];
  let sequence = 0;
  let update: Record<string, string> | undefined;
  const fail = (reply: FastifyReply, error: unknown) => { const result = dependencies.processError(error); return reply.code(result.statusCode).send(result.body); };

  app.post("/api/desktop/deep-link", async (request, reply) => {
    const url = (request.body as { url?: unknown } | undefined)?.url;
    if (!isDeepLink(url)) return reply.code(400).send({ error: "deep_link_invalid", message: "Only fngk-atlas:// URLs are accepted." });
    const event = { seq: ++sequence, url, receivedAt: new Date().toISOString() };
    deepLinks.push(event);
    if (deepLinks.length > MAX_DEEP_LINKS) deepLinks.shift();
    return reply.code(202).send(event);
  });

  app.get("/api/desktop/deep-links", async (request) => {
    const after = Number((request.query as { after?: string }).after ?? 0) || 0;
    return { items: deepLinks.filter(item => item.seq > after), latest: sequence };
  });

  app.post("/api/desktop/update-state", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (typeof body.status !== "string" || !updateStatuses.has(body.status)) return reply.code(400).send({ error: "update_state_invalid", message: "Unknown update status." });
    update = { status: body.status, checkedAt: new Date().toISOString() };
    for (const key of ["version", "currentVersion", "message"] as const) if (typeof body[key] === "string") update[key] = String(body[key]).slice(0, key === "message" ? 400 : 64);
    return reply.code(204).send();
  });

  app.get("/api/desktop/info", async () => ({
    desktop: environment.desktop,
    atlasVersion: environment.atlasVersion ?? process.env.npm_package_version ?? "development",
    fngk: {
      bundledVersion: environment.bundledVersion,
      installedVersion: await provisioner.currentVersion(),
      installPath: provisioner.target,
      provision: environment.provision,
      ...(environment.provisionError ? { provisionError: environment.provisionError } : {}),
      manifestUrl: environment.manifestUrl,
    },
    ...(update ? { update } : {}),
  }));

  app.post("/api/onboarding/install", async (request, reply) => {
    const body = request.body as { scope?: unknown; confirm?: unknown } | undefined;
    if (body?.confirm !== true) return reply.code(409).send({ error: "confirmation_required", message: "Installing FNGK requires confirmation." });
    if (body.scope !== undefined && body.scope !== "user" && body.scope !== "system") return reply.code(400).send({ error: "install_scope_invalid", message: "Install scope must be user or system." });
    const events: BootstrapProgress[] = [];
    try { for await (const event of bootstrap.install((body.scope as "user" | "system" | undefined) ?? "user", dependencies.signal(request))) events.push(event); return { snapshot: bootstrap.snapshot(), events }; }
    catch (error) { return fail(reply, error); }
  });

  app.get("/api/fngk/signed-update", async (request) => provisioner.checkForUpdate(dependencies.signal(request)));

  app.post("/api/fngk/signed-update", async (request, reply) => {
    if ((request.body as { confirm?: unknown } | undefined)?.confirm !== true) return reply.code(409).send({ error: "confirmation_required", message: "Updating FNGK requires confirmation." });
    const events: BootstrapProgress[] = [], signal = dependencies.signal(request), profile = dependencies.profile();
    try {
      const before = await bootstrap.check(profile, signal).catch(() => undefined);
      const result = await provisioner.applyUpdate(event => events.push(event), signal);
      if (result.state === "recoverable-error") return reply.code(502).send({ error: result.errorCode ?? "fngk_update_failed", message: result.message, result, events });
      // The daemon keeps running the old binary until its service is re-converged.
      if (before?.local.daemon === "reachable") for await (const event of bootstrap.converge(profile, signal)) events.push(event);
      return { result, events, snapshot: bootstrap.snapshot() };
    } catch (error) { return fail(reply, error); }
  });
}

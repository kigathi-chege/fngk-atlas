import {createProfileScope} from './profile-scope.js';
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { RawData } from "ws";
import { analyze } from "../analyzer.js";
import { Store } from "../store.js";
import { runFunction } from "../sandbox.js";
import { observeLocalProcesses } from "../runtime.js";
import { FngkProcessClient, FngkProcessError } from "../fngk/process-client.js";
import { redact } from "../fngk/redaction.js";
import type { TerminalInput } from "../fngk/protocol.js";
import { EffectiveContextService } from "./context-service.js";
import { HostDiscovery } from "../discovery/host-discovery.js";
import { EvidenceStore } from "../store/evidence-store.js";
import { CoverageService } from "../coverage/service.js";
import { coverageCommands } from "../coverage/commands.js";
import { posixQuote } from "../transports/posix.js";
import { correlateRuntime } from "../correlation/runtime-code.js";
import { analyzeRepository } from "../analysis/repository-analyzer.js";
import { redactCommandLine } from "../discovery/redaction.js";
import { discoverDatabases } from "../databases/discovery.js";
import { LiveProjectService } from "../live-projects/service.js";
import { diagnoseBrowser } from "../diagnostics/browser-diagnostics.js";
import { DiagnosticRegistry } from "../diagnostics/registry.js";
import { WorldStore } from "../world/store.js";
import { WorldService } from "../world/service.js";
import { backgroundRefresh } from "../world/background-refresh.js";
import { loadInterpreterRegistry } from "../world/registry.js";
import {
  loadDeviceAdapters,
  runDeviceAdapter,
  type RegisteredDeviceAdapter,
} from "../world/device-adapter.js";
import {
  AtlasIntelligenceService,
  HttpCalculatorProvider,
  type CalculatorProvider,
} from "../intelligence/service.js";
import { DeploymentService } from "../deployments/service.js";
import { interpretDeploymentProject } from "../deployments/adapters.js";
import { projectSoftwareFunctions } from "../world/software-projection.js";
import { PortShareStore } from "../ports/store.js";
import { PortSharingService } from "../ports/service.js";
import { FngkHeadHandoffService } from "../fngk-head/handoff-service.js";
import { BootstrapService } from "../onboarding/service.js";
import { AuthFlow } from "../onboarding/auth-flow.js";
import { createLocalFngkLoginLauncher, FngkBrowserAuthorizationRuntime } from "../onboarding/fngk-auth.js";
import { DeviceLifecycleService } from "../lifecycle/service.js";
import { DeviceSessionManager, type DeviceSessionLease } from "../device-sessions/manager.js";
import type { DeviceScope, DeviceSessionSnapshot } from "../device-sessions/types.js";
import { FilesystemCache } from "../device-sessions/filesystem-cache.js";
import { FileService } from "../files/file-service.js";
import { TerminalFileTransport } from "../transports/terminal-file.js";
import { AtlasToolRegistry } from '../agent-tools/registry.js';
import { AtlasToolExecutor } from '../agent-tools/executor.js';
import { GrantStore } from '../agent-tools/grants.js';
import { HttpCalculatorConversationGateway, type CalculatorConversationGateway } from '../intelligence/conversation-gateway.js';
import { CalculatorConnectionService } from '../integrations/calculator-connection.js';

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const terminalInputs = new Set([
  "input",
  "command",
  "resize",
  "interrupt",
  "mode",
  "control_request",
  "control_resolve",
  "nested_approval_resolve",
  "detach",
  "stop",
]);

interface CreateAppOptions {
  fngk?: FngkProcessClient;
  dbPath?: string;
  root?: string;
  localRoot?: string;
  logger?: boolean;
  diagnosticRegistry?: DiagnosticRegistry;
  calculatorProvider?: CalculatorProvider;
  calculatorConversationGateway?: CalculatorConversationGateway;
  deviceAdapters?: RegisteredDeviceAdapter[];
  worldRefreshMode?: 'inline'|'worker';
  capability?: string;
}

function processError(error: unknown): {
  statusCode: number;
  body: Record<string, unknown>;
} {
  const details = error as {
    diagnosticSessionId?: string;
    liveProjectSession?: unknown;
    causes?: Array<{code?:string;message?:string}>;
  };
  const extra = {
    ...(details.diagnosticSessionId
      ? { diagnosticSessionId: details.diagnosticSessionId }
      : {}),
    ...(details.liveProjectSession
      ? { liveProjectSession: details.liveProjectSession }
      : {}),
    ...(Array.isArray(details.causes)?{routeCauses:details.causes.slice(0,8).map(value=>({code:String(value.code??'route_failed').slice(0,80),message:redact(String(value.message??'Route failed.')).slice(0,500)}))}:{}),
  };
  if (error instanceof FngkProcessError) {
    const statusCode =
      error.code === "binary_missing" || error.code === "daemon_unavailable"
        ? 503
        : error.code === "authentication_required"
          ? 401
          : error.code === "unsupported_protocol"
            ? 409
            : error.code === "timeout"
              ? 504
              : 502;
    return {
      statusCode,
      body: { error: error.code, message: error.message, ...extra },
    };
  }
  const value = error as { code?: string; message?: string };
  const code = value.code ?? "internal_error";
  const statusCode =
    code === "context_not_found"
      ? 404
      : code === "device_offline" ||
          code === "route_unavailable" ||
          code === "file_conflict"
        ? 409
        : code === "invalid_path" ||
            code === "path_escape" ||
            code === "protected_path"
          ? 400
          : code === "cancelled"
            ? 499
            : 500;
  return {
    statusCode,
    body: {
      error: code,
      message: value.message ?? "Unexpected error.",
      ...extra,
    },
  };
}

function requestSignal(
  request: { raw: NodeJS.EventEmitter },
  reply?: { raw: NodeJS.EventEmitter & { writableEnded?: boolean } },
): AbortSignal {
  const controller = new AbortController();
  request.raw.once("aborted", () => controller.abort());
  reply?.raw.once("close", () => {
    if (!reply.raw.writableEnded) controller.abort();
  });
  return controller.signal;
}

export async function createApp(
  options: CreateAppOptions = {},
): Promise<FastifyInstance> {
  const root = options.root ?? projectRoot;
  const databaseFile =
    options.dbPath ??
    process.env.ATLAS_DB ??
    path.join(root, ".atlas", "atlas.db");
  const store = new Store(databaseFile);
  const fngk = options.fngk ?? new FngkProcessClient();
  const bootstrap = new BootstrapService(fngk);
  const browserAuthorizations = new Map<string, AuthFlow>();
  const profileScope=createProfileScope();
  fngk.setProfileProvider?.(profileScope.current);
  const contexts = new EffectiveContextService(fngk, {
    profile:profileScope.current,
    localRoot: options.localRoot,
  });
  const deviceSessions = new DeviceSessionManager({
    createSession: (scope, signal) =>
      fngk.openTerminal(`device:${scope.deviceId}`, {
        newSession: true,
        profile: scope.profile,
        signal,
        owner:'atlas-internal',
        purpose:'device-session',
      }),
  });
  const atlasUserTerminals=new Map<string,{deviceId:string;profile?:string;owner:'atlas-user';purpose:'interactive'}>();
  const isUserTerminal=(session:{id?:unknown})=>typeof session.id==='string'&&atlasUserTerminals.has(session.id);
  const scopedFileService = (scope: DeviceScope, lease: DeviceSessionLease) => new FileService([new TerminalFileTransport({
    id: `terminal:${scope.deviceId}`,
    contextId: `device:${scope.deviceId}`,
    deviceId: scope.deviceId,
    executor: lease.commandExecutor(scope),
  })]);
  const filesystemCache = new FilesystemCache({
    sessions: deviceSessions,
    service: scopedFileService,
  });
  const retryableFileFailure=(error:unknown)=>{const value=error as {code?:string;causes?:Array<{code?:string}>};return value.code==='route_unavailable'&&value.causes?.some(cause=>['terminal_closed','timeout','process_error','process_failed','invalid_json','unsupported_protocol'].includes(String(cause.code)))===true};
  const readThroughFiles=async<T>(contextId:string,operation:(service:Awaited<ReturnType<EffectiveContextService['files']>>)=>Promise<T>)=>{try{return await operation(await contexts.files(contextId))}catch(error){if(contextId==='local'||!retryableFileFailure(error))throw error;contexts.release(contextId);return await operation(await contexts.files(contextId))}};
  const evidence = new EvidenceStore(databaseFile);
  let interpreterTrust: Record<string, string> = {};
  try {
    interpreterTrust = JSON.parse(process.env.ATLAS_INTERPRETER_TRUST ?? "{}");
  } catch {}
  const extensionInterpreters = await loadInterpreterRegistry({
    production: process.env.NODE_ENV === "production",
    signedDir: process.env.ATLAS_INTERPRETER_DIR,
    devDir: process.env.ATLAS_INTERPRETER_DEV_DIR,
    trust: interpreterTrust,
  });
  const deviceAdapters =
    options.deviceAdapters ??
    (await loadDeviceAdapters({
      production: process.env.NODE_ENV === "production",
      signedDir: process.env.ATLAS_DEVICE_ADAPTER_DIR,
      devDir: process.env.ATLAS_DEVICE_ADAPTER_DEV_DIR,
      trust: interpreterTrust,
    }));
  const worldStore = new WorldStore(databaseFile),
    world = new WorldService(worldStore, extensionInterpreters);
  const worldRefreshMode=options.worldRefreshMode??(process.env.NODE_ENV==='test'?'inline':'worker');
  const callbackOrigin = process.env.ATLAS_CALLBACK_ORIGIN ?? `http://${process.env.ATLAS_HOST ?? '127.0.0.1'}:${process.env.ATLAS_PORT ?? '3000'}`;
  const calculatorConnection = new CalculatorConnectionService(databaseFile, callbackOrigin);
  const storedCalculatorToken = calculatorConnection.bearer();
  const storedCalculatorOrigin = calculatorConnection.status().connection?.origin;
  let calculatorProvider =
      options.calculatorProvider ??
      (storedCalculatorOrigin && storedCalculatorToken
        ? new HttpCalculatorProvider(storedCalculatorOrigin, storedCalculatorToken)
        : process.env.ATLAS_CALCULATOR_URL
        ? new HttpCalculatorProvider(
            process.env.ATLAS_CALCULATOR_URL,
            process.env.ATLAS_CALCULATOR_TOKEN,
          )
        : undefined);
  let calculatorConversationGateway = options.calculatorConversationGateway ?? (storedCalculatorOrigin && storedCalculatorToken ? new HttpCalculatorConversationGateway(storedCalculatorOrigin, storedCalculatorToken) : process.env.ATLAS_CALCULATOR_URL ? new HttpCalculatorConversationGateway(process.env.ATLAS_CALCULATOR_URL, process.env.ATLAS_CALCULATOR_TOKEN) : undefined);
  const intelligence = new AtlasIntelligenceService(
      worldStore,
      world,
      calculatorProvider,
    );
  let activeIndex = store.latestIndex();
  const resolveIndex = (indexId?: string, contextId?: string) =>
    indexId
      ? store.index(indexId)
      : contextId
        ? store.latestIndex(contextId)
        : activeIndex;
  const diagnostics = options.diagnosticRegistry ?? new DiagnosticRegistry();
  const lifecycle = new DeviceLifecycleService({
    profiles: () => fngk.profiles(),
    contexts: (profile) => contexts.contexts({profile}),
  });
  const portStore = new PortShareStore(databaseFile);
  const portSharing = new PortSharingService(portStore,fngk,{diagnostics,executorFor:(contextId)=>contexts.commandExecutor(contextId)});
  const headHandoffs = new FngkHeadHandoffService({artifactRoot:process.env.FNGK_HEAD_OUTPUT??path.join(root,'output','fngk-head'),signalRoot:process.env.SIGNAL_SOURCE??path.resolve(root,'../signal'),ports:portSharing,executorFor:(contextId)=>contexts.commandExecutor(contextId),diagnostics});
  const liveProjects = new LiveProjectService(fngk, {
    diagnostics,
    commandExecutor: (contextId) => contexts.commandExecutor(contextId),
  });
  const deployments = new DeploymentService(fngk, (contextId) =>
    contexts.commandExecutor(contextId),
  );
  const deploymentsEnabled = process.env.ATLAS_DEPLOYMENTS_ENABLED !== "0";
  // Normalize live/deployment sessions into semantic observations. The existing
  // services remain authoritative; these bounded records only feed the world
  // resolver and are intentionally not persisted as a second runtime model.
  const specialistNodes = (contextId: string) => {
    const nodes: any[] = [];
    for (const session of liveProjects
      .list()
      .filter((value) => value.contextId === contextId)) {
      const anchor = `live:${session.id}`,
        label =
          session.repositoryPath.split("/").at(-1) ?? session.repositoryPath;
      nodes.push({
        id: `${anchor}:service`,
        type: "service",
        label: `Live project · ${label}`,
        metadata: {
          serviceName: anchor,
          repositoryPath: session.repositoryPath,
          command: session.command,
          status: session.status,
          runId: session.runId,
          processId: session.processId,
        },
      });
      if (session.processId)
        nodes.push({
          id: `${anchor}:process`,
          type: "process",
          label: String(session.processId),
          metadata: {
            serviceName: anchor,
            command: session.command,
            status: session.status,
            repositoryPath: session.repositoryPath,
            runId: session.runId,
          },
        });
      nodes.push({
        id: `${anchor}:port`,
        type: "port",
        label: `:${session.port}`,
        metadata: {
          serviceName: anchor,
          protocol: "http",
          port: session.port,
          hostname: session.hostname,
          url: session.url,
          status: session.status,
        },
      });
    }
    for (const operation of evidence.operations(contextId, 200)) {
      nodes.push({
        id: `operation:${operation.id}`,
        type: "operation",
        label: operation.type,
        observedAt: operation.recordedAt,
        metadata: {
          operationType: operation.type,
          recordedAt: operation.recordedAt,
          route: operation.route,
          summary: operation.summary,
        },
      });
      if (!operation.type.startsWith("deployment.")) continue;
      const summary = operation.summary ?? {},
        deploymentId = String(
          summary.deploymentId ?? summary.releaseId ?? operation.id,
        ),
        anchor = `deployment:${deploymentId}`;
      nodes.push({
        id: `${anchor}:service`,
        type: "service",
        label: `Deployment · ${deploymentId.slice(0, 18)}`,
        metadata: {
          serviceName: anchor,
          status: summary.status,
          environment: summary.environment,
          repositoryPath: summary.repositoryPath,
          commitSha: summary.commitSha,
          releaseId: summary.releaseId,
        },
      });
    }
    return nodes;
  };
  const worldRefreshState = new Map<
    string,
    { sourceKey: string; deviceKey: string; checkedAt: number }
  >();
  const worldRefreshes = new Map<string, Promise<any>>();
  let worldRefreshTail:Promise<void>=Promise.resolve();
  const computeWorld = async (contextId: string, force = false) => {
    const index = resolveIndex(undefined, contextId),
      runtimeNodes = [
        ...evidence.entities(contextId),
        ...specialistNodes(contextId),
      ],
      relationships = evidence.relationships(contextId),
      runtimeEdges = relationships.map((value) => ({
        id: value.id,
        source: value.sourceId,
        target: value.targetId,
        type: value.type,
        evidence: value.evidence,
        observedAt: value.observedAt,
        stale: value.stale,
      })),
      liveSignature = liveProjects
        .list()
        .filter((value) => value.contextId === contextId)
        .map((value) =>
          [
            value.id,
            value.status,
            value.processId,
            value.runId,
            value.hostname,
            value.url,
            value.output.length,
          ].join(":"),
        )
        .join("|"),
      latest = [...runtimeNodes, ...relationships].reduce(
        (value, item) =>
          String(item.observedAt ?? "") > value
            ? String(item.observedAt)
            : value,
        "",
      ),
      sourceKey = [
        index?.id,
        index?.revision,
        index?.nodes?.length,
        index?.edges?.length,
        runtimeNodes.length,
        runtimeEdges.length,
        liveSignature,
        latest,
      ].join(":");
    const previous = worldRefreshState.get(contextId);
    if (
      !force &&
      previous?.sourceKey === sourceKey &&
      Date.now() - previous.checkedAt < 5_000
    )
      return index;
    let device: any;
    try {
      device = (await contexts.contexts({force})).contexts.find(
        (value:any) => value.id === contextId,
      );
    } catch {}
    if(!device)device={id:contextId,name:contextId,online:contextId==='local'};
    const deviceKey = [device?.id, device?.online, device?.name].join(":");
    if (force||previous?.sourceKey !== sourceKey || previous.deviceKey !== deviceKey){
      const nodes=[...(index?.nodes??[]),...runtimeNodes],edges=[...(index?.edges??[]),...runtimeEdges];
      if(worldRefreshMode==='worker'&&databaseFile!==':memory:'){
        const pending=worldRefreshTail.catch(()=>{}).then(()=>backgroundRefresh({databaseFile,contextId,nodes,edges,device,extensions:extensionInterpreters}));
        worldRefreshTail=pending;
        await pending;
      }
      else world.refresh(contextId,nodes,edges,device);
    }
    worldRefreshState.set(contextId, {
      sourceKey,
      deviceKey,
      checkedAt: Date.now(),
    });
    return index;
  };
  const refreshWorld = (contextId:string,options:{force?:boolean}={})=>{
    const existing=worldRefreshes.get(contextId);if(existing)return existing;
    const pending=computeWorld(contextId,options.force===true).finally(()=>{if(worldRefreshes.get(contextId)===pending)worldRefreshes.delete(contextId)});
    worldRefreshes.set(contextId,pending);return pending;
  };
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 2 << 20 });
  profileScope.install(app);
  const launchCapability = options.capability ?? process.env.ATLAS_CAPABILITY;
  if (launchCapability) app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    // The browser returns from Calculator without Atlas' launch secret. This
    // endpoint still requires a single-use state generated by this process.
    if (request.method === 'GET' && request.url.startsWith('/api/app-connections/callback')) return;
    const header = request.headers["x-atlas-capability"];
    const supplied = Array.isArray(header) ? header[0] : header;
    const protocols = String(request.headers["sec-websocket-protocol"] ?? "").split(",").map(value => value.trim());
    if (supplied === launchCapability || protocols.includes(launchCapability)) return;
    return reply.code(401).send({ error: "atlas_capability_required", message: "This Atlas desktop service requires its launch capability." });
  });
  await app.register(websocket);
  app.addHook("onClose", async () => {
    await deviceSessions.close();
    await liveProjects.close();
    await headHandoffs.close();
    portSharing.close();
    toolGrants.close();
    contexts.close();
    await worldRefreshTail.catch(() => {});
    worldStore.close();
    evidence.close();
    portStore.close();
    store.close();
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY")
      .header("Referrer-Policy", "no-referrer")
      .header(
        "Content-Security-Policy",
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; frame-src 'self' https: http:",
      );
    return payload;
  });

  const scopeError = (code: string, message: string) => Object.assign(new Error(message), { code });
  const scopeField = (value: unknown) => typeof value === 'string' && value ? value : undefined;
  const namespaceContext = (namespace: any, device: Record<string, unknown>, deviceId: string, field: 'teamId' | 'projectId'): string | undefined | null => {
    const values = new Set<string>();
    const direct = scopeField(device[field]); if (direct) values.add(direct);
    for (const resource of namespace.resources ?? []) if (resource.deviceId === deviceId) {
      const value = scopeField((resource as Record<string, unknown>)[field]); if (value) values.add(value);
    }
    return values.size > 1 ? null : [...values][0];
  };
  const resolveDeviceScope = async (input: Record<string, unknown>, request: { raw: NodeJS.EventEmitter }, reply?: { raw: NodeJS.EventEmitter & { writableEnded?: boolean } }): Promise<DeviceScope> => {
    const requestedProfile = scopeField(input.profile), selectedProfile = profileScope.current();
    if (requestedProfile && selectedProfile && requestedProfile !== selectedProfile) throw scopeError('device_scope_mismatch', 'The requested profile does not match this request scope.');
    const namespace = await fngk.namespace(requestedProfile ?? selectedProfile, requestSignal(request, reply));
    const deviceId = scopeField(input.deviceId);
    if (!deviceId) throw scopeError('context_not_found', 'A Device identifier is required.');
    const device = namespace.devices.find(value => value.id === deviceId);
    if (!device) throw scopeError('context_not_found', 'The Device is not available in the selected profile.');
    const authoritativeContext = (field: 'teamId' | 'projectId') => {
      const resolved = namespaceContext(namespace, device, deviceId, field);
      if (resolved === null) throw scopeError('device_scope_mismatch', `The Device has ambiguous ${field} access.`);
      const requested = scopeField(input[field]);
      if (requested && requested !== resolved) throw scopeError('device_scope_mismatch', `The requested ${field} is not authorized for this Device.`);
      return resolved;
    };
    const teamId = authoritativeContext('teamId'), projectId = authoritativeContext('projectId');
    return { profile: namespace.profile.name, ...(teamId ? { teamId } : {}), ...(projectId ? { projectId } : {}), deviceId };
  };
  const scopeForContext = async (contextId: string, profile: string | undefined, request: { raw: NodeJS.EventEmitter }, reply?: { raw: NodeJS.EventEmitter & { writableEnded?: boolean } }, claims: Record<string, unknown> = {}) => {
    if (!contextId.startsWith('device:')) throw scopeError('context_not_found', 'A Device context is required.');
    return await resolveDeviceScope({ ...claims, profile: claims.profile ?? profile, deviceId: contextId.slice('device:'.length) }, request, reply);
  };
  const withScopedFiles = async <T>(contextId: string, claims: Record<string, unknown>, request: { raw: NodeJS.EventEmitter }, reply: { raw: NodeJS.EventEmitter & { writableEnded?: boolean } }, operation: (service: FileService) => Promise<T>, mutation = false): Promise<T> => {
    if (contextId === 'local') return await operation(await contexts.files(contextId));
    const scope = await scopeForContext(contextId, profileScope.current(), request, reply, claims);
    const lease = await deviceSessions.acquire(scope);
    try { return await operation(scopedFileService(scope, lease)); }
    finally { if (mutation) filesystemCache.invalidate(scope); lease.release(); }
  };
  const agentTools = new AtlasToolRegistry();
  const toolGrants = new GrantStore(databaseFile);
  const guardedToolExecutor = (request: { raw: NodeJS.EventEmitter }, reply: { raw: NodeJS.EventEmitter & { writableEnded?: boolean } }) => new AtlasToolExecutor({
    registry: agentTools,
    resolveScope: async (candidate, signal) => {
      const resolved = await resolveDeviceScope({ ...candidate }, request, reply);
      if (signal?.aborted) throw scopeError('cancelled', 'The tool request was cancelled.');
      return resolved;
    },
    acquireFiles: async scope => {
      const lease = await deviceSessions.acquire(scope);
      return { service: scopedFileService(scope, lease), release: () => lease.release() };
    },
    acquireTerminal: async (scope, signal) => {
      if (signal?.aborted) throw scopeError('cancelled', 'The tool request was cancelled.');
      const lease = await deviceSessions.acquire(scope);
      const session = deviceSessions.snapshot(scope);
      if (!session) { lease.release(); throw scopeError('device_session_unavailable', 'The Device Session could not be opened.'); }
      return { session, release: () => lease.release() };
    },
    inspectDeployments: async (scope, signal) => await fngk.deployments(scope.deviceId, { profile: scope.profile, signal }),
    listPorts: async scope => portSharing.list(`device:${scope.deviceId}`),
    inspectDevice: async (scope, signal) => {
      const namespace = await fngk.namespace(scope.profile, signal);
      const device = namespace.devices.find(value => value.id === scope.deviceId);
      if (!device) throw scopeError('context_not_found', 'The Device is no longer available in this profile.');
      return {
        profile: namespace.profile.name,
        device,
        resources: (namespace.resources ?? []).filter(value => value.deviceId === scope.deviceId)
      };
    },
    runTerminalCommand: async (scope, command, signal) => {
      const lease = await deviceSessions.acquire(scope);
      try {
        const result = await lease.commandExecutor(scope).execute(command, { signal, timeoutMs: 30_000 });
        return {
          exitCode: result.exitCode,
          stdout: redact(result.output.toString('utf8')).slice(0, 1_000_000),
          stderr: ''
        };
      } finally { lease.release(); }
    },
    grants: toolGrants
  });

  app.get("/api/health", async () => ({
    ok: true,
    version: "0.2.0",
    activeIndex: activeIndex?.summary ?? null,
  }));
  app.get('/api/agent-tools', async () => ({ tools: agentTools.list() }));
  app.get('/api/app-connections/status', async () => calculatorConnection.status());
  app.post('/api/app-connections/connect', async (request, reply) => {
    try {
      const origin = String((request.body as { origin?: string })?.origin ?? '');
      return reply.code(201).send(calculatorConnection.begin({ origin }));
    } catch (error) { return reply.code(400).send({ error:'app_connection_invalid', message:(error as Error).message }); }
  });
  app.get('/api/app-connections/callback', async (request, reply) => {
    try {
      const query=request.query as { code?:string; state?:string };
      const complete=await calculatorConnection.complete(query);
      const connection=complete.connection!;
      const token=calculatorConnection.bearer()!;
      calculatorProvider=new HttpCalculatorProvider(connection.origin,token);
      calculatorConversationGateway=new HttpCalculatorConversationGateway(connection.origin,token);
      return reply.type('text/html; charset=utf-8').header('cache-control','no-store').send('<!doctype html><title>Atlas connected</title><body><p>FNGK Atlas is connected to Calculator. You may close this window.</p><script>window.close()</script></body>');
    } catch (error) { return reply.code(400).type('text/html; charset=utf-8').send(`<!doctype html><title>Atlas connection failed</title><body><p>${String((error as Error).message).replace(/[<>&]/g,'')}</p></body>`); }
  });
  app.delete('/api/app-connections', async () => {
    calculatorProvider=undefined; calculatorConversationGateway=undefined;
    return calculatorConnection.disconnect();
  });
  app.get('/api/agent-chat/status', async () => ({ configured: Boolean(calculatorConversationGateway), connection:calculatorConnection.status().connection, health: calculatorConversationGateway ? await calculatorConversationGateway.health() : { available: false, message: 'Connect Calculator from Atlas to begin a conversation.' }, tools: agentTools.list() }));
  app.post('/api/agent-chat/conversations', async (request, reply) => { if (!calculatorConversationGateway) return reply.code(503).send({ error: 'calculator_unavailable', message: 'Calculator provider is not configured.' }); try { const value: any = await calculatorConversationGateway.create(request.body as any); return reply.code(201).send({ ...value, conversationId: value.conversationId ?? value.session?.id }); } catch (error) { return reply.code(502).send({ error: 'calculator_unavailable', message: (error as Error).message }); } });
  app.post('/api/agent-chat/conversations/:id/messages', async (request, reply) => { if (!calculatorConversationGateway) return reply.code(503).send({ error: 'calculator_unavailable', message: 'Calculator provider is not configured.' }); try { return reply.code(202).send(await calculatorConversationGateway.message(decodeURIComponent(String((request.params as any).id)), request.body)); } catch (error) { return reply.code(502).send({ error: 'calculator_unavailable', message: (error as Error).message }); } });
  app.post('/api/agent-chat/conversations/:id/cancel', async (request, reply) => { if (!calculatorConversationGateway) return reply.code(503).send({ error: 'calculator_unavailable', message: 'Calculator provider is not configured.' }); try { return reply.send(await calculatorConversationGateway.cancel(decodeURIComponent(String((request.params as any).id)))); } catch (error) { return reply.code(502).send({ error: 'calculator_unavailable', message: (error as Error).message }); } });
  app.post('/api/agent-chat/conversations/:id/steer', async (request, reply) => { if (!calculatorConversationGateway) return reply.code(503).send({ error: 'calculator_unavailable', message: 'Calculator provider is not configured.' }); try { return reply.send(await calculatorConversationGateway.steer(decodeURIComponent(String((request.params as any).id)), request.body)); } catch (error) { return reply.code(502).send({ error: 'calculator_unavailable', message: (error as Error).message }); } });
  app.get('/api/agent-chat/conversations/:id/events', async (request, reply) => { if (!calculatorConversationGateway) return reply.code(503).send({ error: 'calculator_unavailable', message: 'Calculator provider is not configured.' }); try { const upstream = await calculatorConversationGateway.events(decodeURIComponent(String((request.params as any).id)), String((request.query as any).cursor ?? '') || undefined); reply.hijack(); reply.raw.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' }); for await (const chunk of upstream.body as any) reply.raw.write(chunk); reply.raw.end(); } catch (error) { return reply.code(502).send({ error: 'calculator_unavailable', message: (error as Error).message }); } });
  app.get('/api/agent-tools/grants', async () => ({ grants: toolGrants.list() }));
  app.post('/api/agent-tools/grants', async (request, reply) => { const body = (request.body ?? {}) as any; try { if (!body.scope || !Array.isArray(body.toolIds) || !body.actor || !['once','conversation','durable','full_access'].includes(body.kind)) throw scopeError('tool_input_invalid','A valid scope, actor, grant kind, and tool list are required.'); const scope = await resolveDeviceScope({ ...body.scope }, request, reply); return reply.code(201).send({ grant: toolGrants.create({ scope, toolIds: body.toolIds.map(String).slice(0,32), kind: body.kind, actor: String(body.actor).slice(0,256), expiresAt: typeof body.expiresAt === 'string' ? body.expiresAt : undefined }) }); } catch (error) { const result = processError(error); return reply.code(result.statusCode).send(result.body); } });
  app.post('/api/agent-tools/grants/:id/revoke', async (request) => ({ revoked: toolGrants.revoke(decodeURIComponent(String((request.params as any).id ?? '')), String(((request.body ?? {}) as any).actor ?? 'operator').slice(0,256)) }));
  app.get('/api/agent-tools/:id', async (request, reply) => {
    const descriptor = agentTools.describe(decodeURIComponent(String((request.params as { id?: string }).id ?? '')));
    return descriptor ? descriptor : reply.code(404).send({ error: 'tool_not_found' });
  });
  app.post('/api/agent-tools/:id/execute', async (request, reply) => {
    const body = (request.body ?? {}) as { input?: Record<string, unknown>; scope?: DeviceScope };
    try {
      if (!body.scope || !body.input) throw scopeError('tool_input_invalid', 'Tool input and Device scope are required.');
      return await guardedToolExecutor(request, reply).execute({ toolId: decodeURIComponent(String((request.params as { id?: string }).id ?? '')), input: body.input, scope: body.scope, signal: requestSignal(request, reply) });
    } catch (error) { const result = processError(error); return reply.code(result.statusCode).send(result.body); }
  });
  app.get("/api/onboarding/status", async (request, reply) => {
    try { return await bootstrap.check(profileScope.current(), requestSignal(request)); }
    catch (error) { const result = processError(error); return reply.code(result.statusCode).send(result.body); }
  });
  app.post("/api/onboarding/converge", async (request, reply) => {
    const body = request.body as { profile?: unknown; confirm?: unknown } | undefined;
    if (body?.confirm !== true) return reply.code(409).send({ error: "confirmation_required", message: "FNGK daemon convergence requires confirmation." });
    const profile = typeof body.profile === "string" ? body.profile : profileScope.current(), events = [];
    try { for await (const event of bootstrap.converge(profile, requestSignal(request))) events.push(event); return { snapshot: bootstrap.snapshot(), events }; }
    catch (error) { const result = processError(error); return reply.code(result.statusCode).send(result.body); }
  });
  app.post("/api/onboarding/login/begin", async (request, reply) => {
    const body = request.body as { profile?: unknown; origin?: unknown } | undefined;
    if (typeof body?.origin !== "string") return reply.code(400).send({ error: "authorization_origin_invalid", message: "A secure Signal origin is required." });
    const profile = typeof body.profile === "string" ? body.profile : "local";
    try {
      const runtime = new FngkBrowserAuthorizationRuntime(createLocalFngkLoginLauncher(fngk.binary, fngk.env), fngk.binary, body.origin), flow = new AuthFlow(runtime, { origin: body.origin }), start = await flow.beginLogin(profile);
      browserAuthorizations.set(start.stateId, flow); return reply.code(201).send(start);
    } catch (error) { const result = processError(error); return reply.code(result.statusCode).send(result.body); }
  });
  app.post("/api/onboarding/login/complete", async (request, reply) => {
    const body = request.body as { stateId?: unknown; origin?: unknown; receivedAt?: unknown; code?: unknown } | undefined;
    if (typeof body?.stateId !== "string") return reply.code(400).send({ error: "authorization_state_invalid", message: "Authorization state is required." });
    const flow = browserAuthorizations.get(body.stateId); if (!flow) return reply.code(404).send({ error: "authorization_state_invalid", message: "Authorization state is unavailable." });
    try {
      const result = await flow.completeLogin({ stateId: body.stateId, origin: typeof body.origin === "string" ? body.origin : "", receivedAt: typeof body.receivedAt === "string" ? body.receivedAt : "", ...(typeof body.code === "string" ? { code: body.code } : {}) }); browserAuthorizations.delete(body.stateId); return result;
    } catch (error) { const result = processError(error); return reply.code(result.statusCode).send(result.body); }
  });
  app.post("/api/onboarding/login/:stateId/cancel", async (request, reply) => {
    const stateId = String((request.params as { stateId?: string }).stateId ?? ""), flow = browserAuthorizations.get(stateId); if (!flow) return reply.code(404).send({ error: "authorization_state_invalid", message: "Authorization state is unavailable." });
    await flow.cancelLogin(stateId); browserAuthorizations.delete(stateId); return reply.code(204).send();
  });
  app.get("/api/indexes", async (request) => ({
    items: store.indexes(
      String((request.query as { contextId?: string }).contextId ?? "") ||
        undefined,
    ),
  }));
  app.get("/favicon.ico", async (_request, reply) => reply.code(204).send());
  app.get("/api/fngk/context", async (request, reply) => {
    const profile =
      String((request.query as { profile?: string }).profile ?? "") ||
      undefined;
    const state = await fngk.probe(profile, requestSignal(request));
    return state.installed ? state : reply.code(503).send(state);
  });
  app.get("/api/fngk/profiles", async (request, reply) => {
    try {
      return await fngk.profiles(requestSignal(request));
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.get("/api/device-lifecycle", async (request, reply) => {
    const query = request.query as { contextId?: string; profile?: string };
    const contextId = String(query.contextId ?? "");
    if (!contextId) return reply.code(400).send({ error: "context_required", message: "A Device context is required." });
    try {
      return await lifecycle.inspect(contextId, String(query.profile ?? "") || undefined);
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  const lifecycleAction=async(request:any,reply:any,action:'disconnect'|'retire'|'delete')=>{
    const body=request.body as {contextId?:unknown;profile?:unknown;confirm?:unknown;confirmation?:unknown}|undefined,contextId=typeof body?.contextId==='string'?body.contextId:'';
    if(!contextId.startsWith('device:'))return reply.code(400).send({error:'device_context_required',message:'A Device context is required.'});
    if(body?.confirm!==true)return reply.code(409).send({error:'confirmation_required',message:'Confirm this Device lifecycle action before continuing.'});
    if(action==='delete'&&String(body?.confirmation??'').trim()!==contextId)return reply.code(409).send({error:'device_confirmation_required',message:'Type the exact Device ID to confirm permanent deletion.'});
    const readiness=await lifecycle.inspect(contextId,typeof body?.profile==='string'?body.profile:undefined),capability=readiness.capabilities[action];
    if(!capability.available)return reply.code(409).send({error:'lifecycle_capability_unavailable',message:capability.reason,capabilities:readiness.capabilities});
    // Only the documented local route release exists today. Retire/delete remain capability-gated above.
    const released=contexts.release(contextId,false,readiness.profile?.name);
    if(released)evidence.invalidateContext(contextId,'terminal_disconnected');
    return {action,contextId,released,capabilities:readiness.capabilities};
  };
  app.post('/api/device-lifecycle/disconnect',async(request,reply)=>{try{return await lifecycleAction(request,reply,'disconnect')}catch(error){const result=processError(error);return reply.code(result.statusCode).send(result.body)}});
  app.post('/api/device-lifecycle/retire',async(request,reply)=>{try{return await lifecycleAction(request,reply,'retire')}catch(error){const result=processError(error);return reply.code(result.statusCode).send(result.body)}});
  app.delete('/api/device-lifecycle/device',async(request,reply)=>{try{return await lifecycleAction(request,reply,'delete')}catch(error){const result=processError(error);return reply.code(result.statusCode).send(result.body)}});
  app.get("/api/fngk/namespace", async (request, reply) => {
    const profile =
      String((request.query as { profile?: string }).profile ?? "") ||
      undefined;
    try {
      return await fngk.namespace(profile, requestSignal(request));
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.get("/api/contexts", async (request, reply) => {
    try {
      const query = request.query as { refresh?: string; profile?: string };
      return await contexts.contexts({force:String(query.refresh??'')==='1',profile:String(query.profile??'')||undefined});
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.get("/api/contexts/terminals", async () => ({
    items: contexts.activeTerminals(),
  }));
  app.get('/api/device-sessions', async (request, reply) => {
    try {
      const selected = profileScope.current(), requested = scopeField((request.query as { profile?: unknown }).profile) ?? selected;
      const namespace = await fngk.namespace(requested, requestSignal(request, reply));
      const authorized = (session: DeviceSessionSnapshot) => {
        if (session.scope.profile !== namespace.profile.name || (selected && session.scope.profile !== selected) || (requested && session.scope.profile !== requested)) return false;
        const device = namespace.devices.find((value: Record<string, unknown>) => value.id === session.scope.deviceId);
        if (!device) return false;
        return session.scope.teamId === namespaceContext(namespace, device, session.scope.deviceId, 'teamId') && session.scope.projectId === namespaceContext(namespace, device, session.scope.deviceId, 'projectId');
      };
      return { items: deviceSessions.snapshot().filter(authorized) };
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post('/api/device-sessions/reconnect', async (request, reply) => {
    try {
      const scope = await resolveDeviceScope((request.body ?? {}) as Record<string, unknown>, request, reply);
      return { session: await deviceSessions.reconnect(scope) };
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post('/api/device-sessions/revoke', async (request, reply) => {
    try {
      const scope = await resolveDeviceScope((request.body ?? {}) as Record<string, unknown>, request, reply);
      return { revoked: await deviceSessions.revoke(scope, 'operator_revoked') };
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post('/api/device-sessions/cache/clear', async (request, reply) => {
    try {
      const scope = await resolveDeviceScope((request.body ?? {}) as Record<string, unknown>, request, reply);
      return { session: deviceSessions.clearCache(scope) };
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.get("/api/fngk/sessions", async (request, reply) => {
    const query = request.query as { profile?: string; deviceId?: string },
      profile = String(query.profile ?? "") || undefined;
    try {
      const value = await fngk.namespace(profile, requestSignal(request));
      const terminals = (value.sessions ?? []).filter(
          (session) => isUserTerminal(session) && (!query.deviceId || session.deviceId === query.deviceId),
        ),
        managed = liveProjects
          .list()
          .filter(
            (session) =>
              !query.deviceId ||
              session.contextId === `device:${query.deviceId}`,
          )
          .map((session) => ({
            id: `managed:${session.id}`,
            title: `Live · ${session.command}`,
            status: session.status,
            deviceId: session.contextId.slice(7),
            deviceName: "Managed process",
            kind: "managed-process",
            processId: session.processId,
            runId: session.runId,
            diagnosticSessionId: session.diagnosticSessionId,
          })),
        sessions: any[] = [...managed, ...terminals];
      const active = sessions.filter(
        (session) =>
          !session.archivedAt &&
          !["stopped", "exited", "failed"].includes(
            String(session.status ?? "").toLowerCase(),
          ),
      );
      return {
        profile: value.profile,
        sessions,
        counts: {
          total: sessions.length,
          active: active.length,
          live: active.filter((session) =>
            ["active", "live", "running", "connected"].includes(
              String(session.status ?? "").toLowerCase(),
            ),
          ).length,
          detached: active.filter(
            (session) =>
              String(session.status ?? "").toLowerCase() === "detached",
          ).length,
          archived: sessions.filter((session) => Boolean(session.archivedAt))
            .length,
        },
      };
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post("/api/fngk/sessions/:id/actions", async (request, reply) => {
    const id = decodeURIComponent((request.params as { id: string }).id),
      body = request.body as {
        action?: "rename" | "restart" | "stop" | "archive" | "restore";
        profile?: string;
        title?: string;
        confirm?: boolean;
      };
    if (
      !body.action ||
      !["rename", "restart", "stop", "archive", "restore"].includes(body.action)
    )
      return reply.code(400).send({ error: "invalid_action" });
    if (["stop", "archive"].includes(body.action) && body.confirm !== true)
      return reply.code(409).send({ error: "confirmation_required" });
    if(!isUserTerminal({id}))return reply.code(404).send({error:'atlas_user_terminal_not_found',message:'Atlas only manages interactive terminals it created. Internal Device Sessions are managed from Device Sessions.'});
    try {
      return await fngk.sessionAction(id, body.action, {
        profile: body.profile,
        title: body.title,
        confirm: body.confirm,
        signal: requestSignal(request),
      });
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post("/api/contexts/:id/release", async (request, reply) => {
    const id = decodeURIComponent((request.params as { id: string }).id),
      body = request.body as { stop?: boolean; confirm?: boolean } | undefined,
      stop = body?.stop === true;
    if (stop && body?.confirm !== true)
      return reply.code(409).send({ error: "confirmation_required" });
    const released = contexts.release(id, stop);
    if (released)
      evidence.invalidateContext(
        id,
        stop ? "terminal_stopped" : "terminal_disconnected",
      );
    return { released, contextId: id, stopped: stop };
  });

  app.post("/api/deployments/interpret", async (request, reply) => {
    const body = request.body as {
        contextId?: string;
        repositoryPath?: string;
        environment?: "development" | "staging" | "production";
      },
      contextId = String(body.contextId ?? "local"),
      repositoryPath = path.posix.normalize(
        String(body.repositoryPath ?? ""),
      ),
      environment = body.environment ?? "development";
    if (!repositoryPath.startsWith("/") || repositoryPath === "/")
      return reply.code(400).send({ error: "invalid_repository_path" });
    if (!(["development", "staging", "production"] as const).includes(environment))
      return reply.code(400).send({ error: "invalid_environment" });
    const metadataName = /^(?:package\.json|composer\.json|artisan|svelte\.config\.(?:js|ts|mjs|cjs)|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|package-lock\.json|Dockerfile(?:\.[A-Za-z0-9._-]+)?|(?:docker-)?compose\.ya?ml|ecosystem\.config\.(?:js|cjs|mjs)|crontab|[A-Za-z0-9._-]*supervisor[A-Za-z0-9._-]*\.conf)$/i;
    try {
      const files = await readThroughFiles(contextId, async (service) => {
        const page = await service.list(
            { contextId, path: repositoryPath },
            { limit: 200 },
          ),
          selected = page.items
            .filter(
              (item) =>
                item.type !== "directory" && metadataName.test(item.name),
            )
            .slice(0, 64),
          collected: Record<string, string> = {};
        let totalBytes = 0;
        for (const item of selected) {
          const opened = await service.read({ contextId, path: item.path });
          if (
            opened.tooLarge ||
            opened.binary ||
            !opened.text ||
            opened.bytes > 256 * 1024 ||
            totalBytes + opened.bytes > 1024 * 1024
          )
            continue;
          collected[item.name] = opened.text;
          totalBytes += opened.bytes;
        }
        return collected;
      });
      return interpretDeploymentProject({ files, environment });
    } catch (error) {
      const result = processError(error);
      return reply
        .code(result.statusCode === 500 ? 400 : result.statusCode)
        .send(result.body);
    }
  });

  app.post("/api/deployments/plan", async (request, reply) => {
    try {
      return deployments.plan(request.body as any);
    } catch (error) {
      const result = processError(error);
      return reply
        .code(result.statusCode === 500 ? 400 : result.statusCode)
        .send(result.body);
    }
  });
  app.post("/api/deployments/execute", async (request, reply) => {
    if (!deploymentsEnabled)
      return reply.code(503).send({ error: "deployments_disabled" });
    const body = request.body as any;
    if (body?.confirm !== true)
      return reply.code(409).send({ error: "confirmation_required" });
    try {
      const result = await deployments.execute(body),
        deployment = `deployment:${result.deploymentId}`,
        release = `release:${result.releaseId}`,
        process = `process:${result.processId}`,
        connection = `connection:${result.connectionId ?? "pending"}`;
      evidence.recordOperation({
        id: randomUUID(),
        type: "deployment.execute",
        contextId: body.contextId,
        route: {
          kind: "managed-process",
          effectiveIdentity: "device-agent",
          privilege: "user",
        },
        summary: result,
        recordedAt: new Date().toISOString(),
      } as any);
      evidence.putProjection(
        result.deploymentId,
        [
          {
            id: deployment,
            contextId: body.contextId,
            type: "deployment",
            name: body.manifest?.name ?? "Deployment",
            metadata: {
              repositoryPath: body.repositoryPath,
              environment: body.environment,
            },
          },
          {
            id: release,
            contextId: body.contextId,
            type: "release",
            name: result.releaseId,
            metadata: {
              commitSha: body.commitSha,
              releasePath: result.releasePath,
              status: result.status,
            },
          },
          {
            id: process,
            contextId: body.contextId,
            type: "process",
            name: result.processId,
            metadata: { runId: result.runId, pid: result.pid },
          },
          {
            id: connection,
            contextId: body.contextId,
            type: "route",
            name: result.hostname ?? result.connectionId ?? "Published route",
            metadata: { url: result.url },
          },
          ...result.artifacts.map((artifact, index) => ({
            id: `artifact:${result.releaseId}:${index}`,
            contextId: body.contextId,
            type: "artifact",
            name: artifact.path,
            metadata: artifact,
          })),
        ],
        [
          {
            id: `${deployment}:release`,
            contextId: body.contextId,
            type: "has_release",
            sourceId: deployment,
            targetId: release,
          },
          {
            id: `${release}:process`,
            contextId: body.contextId,
            type: "runs_as",
            sourceId: release,
            targetId: process,
          },
          {
            id: `${release}:route`,
            contextId: body.contextId,
            type: "served_by",
            sourceId: release,
            targetId: connection,
          },
          ...result.artifacts.map((_artifact, index) => ({
            id: `${release}:artifact:${index}`,
            contextId: body.contextId,
            type: "produces",
            sourceId: release,
            targetId: `artifact:${result.releaseId}:${index}`,
          })),
        ],
      );
      return reply.code(201).send(result);
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.get("/api/deployments", async (request, reply) => {
    const contextId = String((request.query as any).contextId ?? "");
    if (!contextId.startsWith("device:"))
      return reply.code(400).send({ error: "device_context_required" });
    try {
      return await fngk.deployments(contextId.slice(7), {
        profile: String((request.query as any).profile ?? "") || undefined,
        signal: requestSignal(request),
      });
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post("/api/deployments",async(request,reply)=>{const body=request.body as any,contextId=String(body?.contextId??'');if(!contextId.startsWith('device:'))return reply.code(400).send({error:'device_context_required'});if(body?.confirm!==true)return reply.code(409).send({error:'confirmation_required'});const{contextId:_contextId,confirm:_confirm,profile,...input}=body;try{return reply.code(201).send(await fngk.createDeployment(contextId.slice(7),input,{profile:String(profile??'')||undefined,signal:requestSignal(request)}))}catch(error){const result=processError(error);return reply.code(result.statusCode).send(result.body)}});
  app.get("/api/deployment-secrets/key",async(request,reply)=>{const contextId=String((request.query as any).contextId??'');if(!contextId.startsWith('device:'))return reply.code(400).send({error:'device_context_required'});try{return await fngk.deploymentSecretKey(contextId.slice(7),{profile:String((request.query as any).profile??'')||undefined,signal:requestSignal(request)})}catch(error){const result=processError(error);return reply.code(result.statusCode).send(result.body)}});
  app.post("/api/deployment-sources/snapshot",async(request,reply)=>{const body=request.body as any,contextId=String(body?.contextId??''),sourcePath=String(body?.path??'');if(!contextId.startsWith('device:'))return reply.code(400).send({error:'device_context_required'});if(!sourcePath.startsWith('/')||sourcePath==='/')return reply.code(400).send({error:'invalid_source_path'});try{return reply.code(201).send(await fngk.snapshotDeploymentSource(contextId.slice(7),sourcePath,{profile:String(body?.profile??'')||undefined,signal:requestSignal(request)}))}catch(error){const result=processError(error);return reply.code(result.statusCode).send(result.body)}});
  app.post("/api/deployment-secrets",async(request,reply)=>{const body=request.body as any,contextId=String(body?.contextId??'');if(!contextId.startsWith('device:'))return reply.code(400).send({error:'device_context_required'});if(body?.confirm!==true)return reply.code(409).send({error:'confirmation_required'});const envelope=body?.secretEnvelope;if(!envelope||!['ephemeralPublicKey','salt','nonce','ciphertext'].every(key=>typeof envelope[key]==='string'&&envelope[key].length>0))return reply.code(400).send({error:'invalid_secret_envelope'});try{return reply.code(201).send(await fngk.storeDeploymentSecret(contextId.slice(7),envelope,{profile:String(body?.profile??'')||undefined,signal:requestSignal(request)}))}catch(error){const result=processError(error);return reply.code(result.statusCode).send(result.body)}});
  app.put("/api/deployment-secrets/:bindingId",async(request,reply)=>{const body=request.body as any,contextId=String(body?.contextId??''),bindingId=decodeURIComponent(String((request.params as any).bindingId??''));if(!contextId.startsWith('device:'))return reply.code(400).send({error:'device_context_required'});if(body?.confirm!==true)return reply.code(409).send({error:'confirmation_required'});const envelope=body?.secretEnvelope;if(!envelope||!['ephemeralPublicKey','salt','nonce','ciphertext'].every(key=>typeof envelope[key]==='string'&&envelope[key].length>0))return reply.code(400).send({error:'invalid_secret_envelope'});try{return await fngk.rotateDeploymentSecret(contextId.slice(7),bindingId,envelope,{profile:String(body?.profile??'')||undefined,signal:requestSignal(request)})}catch(error){const result=processError(error);return reply.code(result.statusCode).send(result.body)}});
  app.delete("/api/deployment-secrets/:bindingId",async(request,reply)=>{const body=request.body as any,contextId=String(body?.contextId??''),bindingId=decodeURIComponent(String((request.params as any).bindingId??''));if(!contextId.startsWith('device:'))return reply.code(400).send({error:'device_context_required'});if(body?.confirm!==true)return reply.code(409).send({error:'confirmation_required'});try{await fngk.deleteDeploymentSecret(contextId.slice(7),bindingId,{profile:String(body?.profile??'')||undefined,signal:requestSignal(request)});return reply.code(204).send()}catch(error){const result=processError(error);return reply.code(result.statusCode).send(result.body)}});
  app.get("/api/deployments/:id", async (request, reply) => {
    try {
      return await fngk.deployment(
        decodeURIComponent((request.params as any).id),
        { signal: requestSignal(request) },
      );
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post("/api/deployments/:id/actions",async(request,reply)=>{
    const body=request.body as any,action=body?.action as 'approve'|'execute'|'cancel'|'retry';
    if(!['approve','execute','cancel','retry'].includes(action))return reply.code(400).send({error:'invalid_deployment_action'});
    if(body?.confirm!==true)return reply.code(409).send({error:'confirmation_required'});
    const planRevision=Number(body?.planRevision);if(!Number.isInteger(planRevision)||planRevision<1)return reply.code(400).send({error:'invalid_plan_revision'});
    try{const value=await fngk.deploymentAction(decodeURIComponent((request.params as any).id),action,planRevision,{profile:String(body?.profile??'')||undefined,signal:requestSignal(request)});return reply.code(action==='execute'?202:200).send(value)}catch(error){const result=processError(error);return reply.code(result.statusCode).send(result.body)}
  });
  app.get("/api/deployments/:id/logs", async (request, reply) => {
    try {
      const value: any = await fngk.deployment(
          decodeURIComponent((request.params as any).id),
          { signal: requestSignal(request) },
        );
      if(value.version==='fngk.deployment.v2'){
        const after=Math.max(-1,Number((request.query as any).after??-1)),limit=Math.min(1000,Math.max(1,Number((request.query as any).limit??500))),items=(value.phaseLogs??[]).filter((item:any)=>Number(item.sequence)>after).slice(0,limit),nextCursor=items.length?Number(items.at(-1).sequence):after;
        return{run:value.plan??null,items,nextCursor,hasMore:(value.phaseLogs??[]).some((item:any)=>Number(item.sequence)>nextCursor)};
      }
      const
        release = [...(value.releases ?? [])]
          .reverse()
          .find((item: any) => item.process_id),
        processId = release?.process_id;
      if (!processId)
        return { run: null, items: [], nextCursor: -1, hasMore: false };
      return await fngk.managedProcessLogs(processId, {
        runId: String((request.query as any).runId ?? "") || undefined,
        after: Number((request.query as any).after ?? -1),
        limit: Math.min(
          1000,
          Math.max(1, Number((request.query as any).limit ?? 500)),
        ),
        signal: requestSignal(request),
      });
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post("/api/deployments/:id/diagnostics", async (request, reply) => {
    const body = request.body as any;
    if (body?.expression && body?.confirm !== true)
      return reply.code(409).send({ error: "confirmation_required" });
    try {
      const deploymentId = decodeURIComponent((request.params as any).id),
        value: any = await fngk.deployment(deploymentId, {
          signal: requestSignal(request),
        }),
        url = [...(value.events ?? [])]
          .reverse()
          .find((item: any) => item.detail?.url)?.detail?.url;
      if (!url)
        return reply.code(404).send({ error: "deployment_url_not_found" });
      const result = await diagnoseBrowser(String(url), {
        screenshot: body?.screenshot === true,
        expression: body?.expression ? String(body.expression) : undefined,
      });
      if (body?.expression)
        evidence.recordOperation({
          id: randomUUID(),
          type: "deployment.browser.evaluate",
          contextId: String(body.contextId ?? ""),
          route: {
            kind: "browser",
            effectiveIdentity: "playwright",
            privilege: "user",
          },
          summary: {
            deploymentId,
            expressionLength: String(body.expression).length,
          },
          recordedAt: new Date().toISOString(),
        } as any);
      return result;
    } catch (error) {
      return reply
        .code(422)
        .send({
          error: "diagnostics_failed",
          message: (error as Error).message,
        });
    }
  });
  const deploymentConnection = async (id: string, signal: AbortSignal) => {
    const value: any = await fngk.deployment(id, { signal }),
      release = [...(value.releases ?? [])]
        .reverse()
        .find((item: any) => item.connection_id);
    if (!release?.connection_id)
      throw Object.assign(
        new Error("The deployment has no published Connection."),
        { code: "deployment_connection_not_found" },
      );
    return String(release.connection_id);
  };
  app.get("/api/deployments/:id/domains", async (request, reply) => {
    try {
      const signal = requestSignal(request);
      return await fngk.connectionDomains(
        await deploymentConnection(
          decodeURIComponent((request.params as any).id),
          signal,
        ),
        { signal },
      );
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.put("/api/deployments/:id/domains/vanity", async (request, reply) => {
    const body = request.body as any;
    if (body?.confirm !== true)
      return reply.code(409).send({ error: "confirmation_required" });
    try {
      const signal = requestSignal(request);
      return await fngk.setConnectionVanity(
        await deploymentConnection(
          decodeURIComponent((request.params as any).id),
          signal,
        ),
        String(body.slug ?? ""),
        { signal },
      );
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post("/api/deployments/:id/domains/custom", async (request, reply) => {
    const body = request.body as any;
    if (body?.confirm !== true)
      return reply.code(409).send({ error: "confirmation_required" });
    try {
      const signal = requestSignal(request);
      return await fngk.attachConnectionDomain(
        await deploymentConnection(
          decodeURIComponent((request.params as any).id),
          signal,
        ),
        String(body.hostname ?? ""),
        { signal },
      );
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post("/api/deployments/:id/domains/verify", async (request, reply) => {
    if ((request.body as any)?.confirm !== true)
      return reply.code(409).send({ error: "confirmation_required" });
    try {
      const signal = requestSignal(request);
      return await fngk.verifyConnectionDomain(
        await deploymentConnection(
          decodeURIComponent((request.params as any).id),
          signal,
        ),
        { signal },
      );
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post("/api/deployments/:id/rollback", async (request, reply) => {
    if (!deploymentsEnabled)
      return reply.code(503).send({ error: "deployments_disabled" });
    const body = request.body as any;
    if (body?.confirm !== true)
      return reply.code(409).send({ error: "confirmation_required" });
    try {
      return await deployments.rollback(
        decodeURIComponent((request.params as any).id),
        String(body.contextId ?? ""),
      );
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });

  const routeEvidence = (route: {
    id: string;
    kind: string;
    deviceId?: string;
    effectiveIdentity: string;
    privilege: string;
    observedAt: string;
    operations?: string[];
  }) => ({
    id: route.id,
    kind: route.kind,
    deviceId: route.deviceId,
    effectiveIdentity: route.effectiveIdentity,
    privilege: route.privilege,
    observedAt: route.observedAt,
    operations: route.operations ?? [],
  });
  const operationEvidence = (
    type: string,
    contextId: string,
    route: {
      id: string;
      kind: string;
      effectiveIdentity: string;
      privilege: string;
      observedAt: string;
      operations?: string[];
    },
    summary: Record<string, unknown> = {},
  ) => {
    const operation = {
      id: randomUUID(),
      type,
      contextId,
      route: routeEvidence(route),
      summary,
      recordedAt: new Date().toISOString(),
    };
    evidence.recordOperation(operation);
    return operation;
  };
  app.get("/api/operations", async (request) => {
    const query = request.query as { contextId?: string; limit?: string };
    return {
      items: evidence.operations(query.contextId, Number(query.limit) || 200),
    };
  });
  app.get("/api/diagnostics/sessions", async (request) => {
    const query = request.query as { contextId?: string; kind?: string };
    return {
      items: diagnostics
        .list()
        .filter(
          (item) =>
            (!query.contextId || item.contextId === query.contextId) &&
            (!query.kind || item.kind === query.kind),
        ),
    };
  });
  app.get("/api/diagnostics/sessions/:id", async (request, reply) => {
    const value = diagnostics.get(
      decodeURIComponent((request.params as { id: string }).id),
    );
    return (
      value ?? reply.code(404).send({ error: "diagnostic_session_not_found" })
    );
  });
  app.get(
    "/api/diagnostics/sessions/:id/events",
    { websocket: true },
    (socket, request) => {
      const id = decodeURIComponent((request.params as { id: string }).id),
        initial = diagnostics.get(id);
      if (!initial) {
        socket.close(1008, "diagnostic session not found");
        return;
      }
      socket.send(JSON.stringify(initial));
      const send = (value: any) => {
        if (value.id === id && socket.readyState === socket.OPEN)
          socket.send(JSON.stringify(value));
      };
      diagnostics.on("changed", send);
      socket.once("close", () => diagnostics.off("changed", send));
    },
  );
  app.get("/api/databases/discover", async (request, reply) => {
    const contextId = String(
        (request.query as { contextId?: string }).contextId ?? "local",
      ),
      deviceId = contextId.startsWith("device:") ? contextId.slice(7) : "";
    try {
      let executor;
      try {
        executor = await contexts.commandExecutor(contextId);
      } catch {}
      let resources: NonNullable<
        Awaited<ReturnType<FngkProcessClient["namespace"]>>["resources"]
      > = [];
      try {
        resources =
          (await fngk.namespace()).resources?.filter(
            (item) => !deviceId || item.deviceId === deviceId,
          ) ?? [];
      } catch {}
      const result = await discoverDatabases(contextId, executor, resources);
      evidence.syncProjection(
        `database-discovery:${contextId}`,
        contextId,
        result.items.map((item) => ({
          id: `database:${item.id}`,
          contextId,
          type: "database",
          name: `${item.engine} · ${item.host}${item.port ? `:${item.port}` : ""}`,
          metadata: {
            engine: item.engine,
            host: item.host,
            port: item.port,
            socket: item.socket,
            version: item.version,
            source: item.source,
            evidence: item.evidence,
          },
          stale: item.stale,
        })),
      );
      worldRefreshState.delete(contextId);
      return result;
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.get("/api/databases/surface", async (request, reply) => {
    const resourceId = String((request.query as any).resourceId ?? "");
    if (!resourceId)
      return reply.code(400).send({ error: "resource_required" });
    try {
      return await fngk.resourceSurface(resourceId, {
        signal: requestSignal(request),
      });
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.get("/api/databases/bindings", async (request, reply) => {
    const resourceId = String((request.query as any).resourceId ?? "");
    if (!resourceId)
      return reply.code(400).send({ error: "resource_required" });
    try {
      return await fngk.resourceBindings(resourceId, {
        signal: requestSignal(request),
      });
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post("/api/databases/bindings", async (request, reply) => {
    const body = request.body as any;
    if (!body?.resourceId)
      return reply.code(400).send({ error: "resource_required" });
    const { resourceId, contextId: _contextId, ...input } = body;
    try {
      const value = await fngk.createResourceBinding(
        String(resourceId),
        input,
        { signal: requestSignal(request) },
      );
      evidence.recordOperation({
        id: randomUUID(),
        type: "database.profile.create",
        contextId: String(body.contextId ?? ""),
        route: {
          kind: "device-adapter",
          effectiveIdentity: "signal.postgres",
          privilege: "user",
        },
        summary: {
          resourceId,
          name: input.name,
          environment: input.environment,
          hasStoredCredential: Boolean(input.persistCredential),
        },
        recordedAt: new Date().toISOString(),
      } as any);
      return reply.code(201).send(value);
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post("/api/databases/bindings/:id/invoke", async (request, reply) => {
    const body = request.body as any,
      bindingId = decodeURIComponent((request.params as any).id),
      diagnostic = diagnostics.create({
        kind: "database",
        contextId: String(body.contextId ?? ""),
        command: `fngk resources ${bindingId} invoke ${String(body.capability ?? "")}`,
        metadata: { bindingId, capability: body.capability },
      });
    try {
      const {contextId: _contextId, ...invocation}=body;
      const value = await fngk.invokeResourceBinding(bindingId, invocation, {
        signal: requestSignal(request),
      });
      diagnostics.update(diagnostic.id, {
        status: "stopped",
        metadata: {
          ...diagnostic.metadata,
          operationId: value?.operation?.id,
          rowCount: value?.output?.rowCount,
        },
      });
      evidence.recordOperation({
        id: randomUUID(),
        type: `database.${String(body.capability ?? "invoke")}`,
        contextId: String(body.contextId ?? ""),
        route: {
          kind: "device-adapter",
          effectiveIdentity: "signal.postgres",
          privilege: "user",
        },
        summary: {
          capability: body.capability,
          operationId: value?.operation?.id,
          rowCount: value?.output?.rowCount,
          diagnosticSessionId: diagnostic.id,
        },
        recordedAt: new Date().toISOString(),
      } as any);
      return value;
    } catch (error) {
      diagnostics.update(diagnostic.id, {
        status: "failed",
        errorCode: (error as any).code ?? "database_operation_failed",
        error: (error as Error).message,
      });
      const result = processError(error);
      return reply
        .code(result.statusCode)
        .send({ ...result.body, diagnosticSessionId: diagnostic.id });
    }
  });
  app.delete("/api/databases/bindings/:id", async (request, reply) => {
    if ((request.body as any)?.confirm !== true)
      return reply.code(409).send({ error: "confirmation_required" });
    try {
      await fngk.deleteResourceBinding(
        decodeURIComponent((request.params as any).id),
        { signal: requestSignal(request) },
      );
      return reply.code(204).send();
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post("/api/ports/scan",async(request,reply)=>{const body=request.body as {contextId?:string};if(!body?.contextId)return reply.code(400).send({error:'context_required'});try{return await portSharing.scan(String(body.contextId),requestSignal(request,reply))}catch(error){const result=processError(error);return reply.code(result.statusCode).send(result.body)}});
  app.get("/api/ports",async(request,reply)=>{const contextId=String((request.query as {contextId?:string}).contextId??'');if(!contextId)return reply.code(400).send({error:'context_required'});return portSharing.list(contextId)});
  app.post("/api/ports/:id/publish",async(request,reply)=>{const body=request.body as {confirm?:boolean;expiresInMs?:number};try{return reply.code(201).send(await portSharing.publish(decodeURIComponent((request.params as {id:string}).id),{confirm:body?.confirm,expiresInMs:body?.expiresInMs,signal:requestSignal(request,reply)}))}catch(error){const code=String((error as any)?.code??''),result=processError(error);return reply.code(code==='confirmation_required'?409:code==='candidate_not_found'?404:['candidate_stale','port_not_http','fngk_incompatible','publish_protocol_invalid'].includes(code)?409:result.statusCode).send({...result.body,error:code||result.body.error})}});
  app.post("/api/ports/:id/stop",async(request,reply)=>{const body=request.body as {confirm?:boolean};try{return await portSharing.stop(decodeURIComponent((request.params as {id:string}).id),{confirm:body?.confirm,signal:requestSignal(request,reply)})}catch(error){const code=String((error as any)?.code??''),result=processError(error);return reply.code(code==='confirmation_required'?409:result.statusCode).send({...result.body,error:code||result.body.error})}});
  app.post('/api/fngk-head/handoff/prepare',async(request,reply)=>{const body=request.body as {architecture?:string;platform?:string};try{return reply.code(201).send(await headHandoffs.prepare(body?.platform,body?.architecture))}catch(error){const code=String((error as any)?.code??'handoff_prepare_failed');return reply.code(422).send({error:code,message:(error as Error).message})}});
  app.post('/api/fngk-head/handoff/install',async(request,reply)=>{const body=request.body as {handoffId?:string;targetContextId?:string;confirm?:boolean;profile?:string;systemScope?:boolean};if(!body?.handoffId||!body.targetContextId)return reply.code(400).send({error:'invalid_handoff_install'});try{return await headHandoffs.install(body.handoffId,body.targetContextId,{confirm:body.confirm,profile:body.profile,systemScope:body.systemScope})}catch(error){const code=String((error as any)?.code??'handoff_install_failed');return reply.code(code==='confirmation_required'?409:422).send({error:code,message:(error as Error).message,diagnosticSessionId:(error as any)?.diagnosticSessionId,handoff:(error as any)?.handoff})}});
  app.get('/api/fngk-head/handoff/:id',async(request,reply)=>headHandoffs.get(decodeURIComponent((request.params as {id:string}).id))??reply.code(404).send({error:'handoff_not_found'}));
  app.delete('/api/fngk-head/handoff/:id',async(request,reply)=>{if((request.body as any)?.confirm!==true)return reply.code(409).send({error:'confirmation_required'});return{stopped:await headHandoffs.stop(decodeURIComponent((request.params as {id:string}).id))}});

  app.get("/api/live-projects", async () => ({ items: liveProjects.list() }));
  app.post("/api/live-projects", async (request, reply) => {
    const body = request.body as {
      contextId?: string;
      repositoryPath?: string;
      command?: string;
      port?: number;
      ttlMs?: number;
      confirm?: boolean;
    };
    if (body?.confirm !== true)
      return reply.code(409).send({ error: "confirmation_required" });
    try {
      const session = await liveProjects.start({
        contextId: String(body.contextId ?? ""),
        repositoryPath: String(body.repositoryPath ?? ""),
        command: String(body.command ?? ""),
        port: Number(body.port),
        ttlMs: body.ttlMs,
      });
      evidence.recordOperation({
        id: randomUUID(),
        type: "live-project.start",
        contextId: session.contextId,
        route: {
          kind: "terminal",
          effectiveIdentity: "remote-shell",
          privilege: "unknown",
        },
        summary: {
          repositoryPath: session.repositoryPath,
          port: session.port,
          connectionId: session.connectionId,
          url: session.url,
        },
        recordedAt: new Date().toISOString(),
      } as any);
      return reply.code(201).send({ session });
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.delete("/api/live-projects/:id", async (request, reply) => {
    const body = request.body as { confirm?: boolean } | undefined;
    if (body?.confirm !== true)
      return reply.code(409).send({ error: "confirmation_required" });
    return {
      stopped: await liveProjects.stop(
        decodeURIComponent((request.params as { id: string }).id),
      ),
    };
  });
  app.post("/api/live-projects/:id/diagnostics", async (request, reply) => {
    const session = liveProjects.get(
      decodeURIComponent((request.params as { id: string }).id),
    );
    if (!session?.url)
      return reply.code(404).send({ error: "live_project_not_found" });
    const body = request.body as { screenshot?: boolean } | undefined;
    try {
      return await diagnoseBrowser(session.url, {
        screenshot: body?.screenshot === true,
      });
    } catch (error) {
      return reply
        .code(422)
        .send({
          error: "diagnostics_failed",
          message: (error as Error).message,
        });
    }
  });
  app.post("/api/live-projects/:id/actions", async (request, reply) => {
    const id = decodeURIComponent((request.params as { id: string }).id),
      body = request.body as {
        action?: "interrupt" | "restart";
        confirm?: boolean;
      };
    if (body?.confirm !== true)
      return reply.code(409).send({ error: "confirmation_required" });
    if (body.action === "interrupt")
      return (await liveProjects.interrupt(id))
        ? { interrupted: true }
        : reply.code(409).send({ error: "live_project_not_running" });
    if (body.action === "restart") {
      const session = await liveProjects.restart(id);
      return session
        ? { session }
        : reply.code(404).send({ error: "live_project_not_found" });
    }
    return reply.code(400).send({ error: "invalid_action" });
  });
  app.get(
    "/api/live-projects/:id/events",
    { websocket: true },
    (socket, request) => {
      const id = decodeURIComponent((request.params as { id: string }).id),
        send = (session: any) => {
          if (session.id === id && socket.readyState === socket.OPEN)
            socket.send(JSON.stringify(session));
        },
        initial = liveProjects.get(id);
      if (initial) socket.send(JSON.stringify(initial));
      liveProjects.on("changed", send);
      socket.once("close", () => liveProjects.off("changed", send));
    },
  );
  app.get("/api/files", async (request, reply) => {
    const query = request.query as {
      contextId?: string;
      path?: string;
      cursor?: string;
      limit?: string;
    };
    try {
      const contextId=query.contextId??'local';
      if (contextId === 'local') {
        const page = await readThroughFiles(contextId,service=>service.list({ contextId, path: query.path ?? "/" }, { cursor: query.cursor, limit: Number(query.limit) || 100, signal: requestSignal(request, reply) }));
        return { ...page, route: routeEvidence(page.route) };
      }
      const scope = await scopeForContext(contextId, profileScope.current(), request, reply, query);
      const page = await filesystemCache.list(scope, query.path ?? '/', { cursor: query.cursor, limit: Number(query.limit) || 100, signal: requestSignal(request, reply) });
      return { ...page, route: routeEvidence(page.route), diagnostics: filesystemCache.diagnostics(scope) };
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.get("/api/files/content", async (request, reply) => {
    const query = request.query as { contextId?: string; path?: string };
    if (!query.path) return reply.code(400).send({ error: "path_required" });
    try {
      const contextId=query.contextId??'local';
      const value = contextId === 'local'
        ? await readThroughFiles(contextId,service=>service.read({ contextId, path: query.path! }, { signal: requestSignal(request, reply) }))
        : await filesystemCache.read(await scopeForContext(contextId, profileScope.current(), request, reply, query), query.path!, { signal: requestSignal(request, reply) });
      return {
        ...value,
        contentBase64: value.content?.toString("base64"),
        content: undefined,
        route: routeEvidence(value.route),
      };
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.put("/api/files/content", async (request, reply) => {
    const body = request.body as {
      contextId?: string;
      path?: string;
      contentBase64?: string;
      expectedFingerprint?: string;
    };
    if (
      !body.path ||
      typeof body.contentBase64 !== "string" ||
      !body.expectedFingerprint
    )
      return reply.code(400).send({ error: "invalid_write" });
    try {
      const filePath = body.path, contentBase64 = body.contentBase64, expectedFingerprint = body.expectedFingerprint;
      const contextId = body.contextId ?? "local",
        value = await withScopedFiles(contextId, body, request, reply, service => service.write(
          { contextId, path: filePath },
          Buffer.from(contentBase64, "base64"),
          expectedFingerprint,
        ), true);
      return {
        ...value,
        route: routeEvidence(value.route),
        operation: operationEvidence("file.write", contextId, value.route, {
          path: body.path,
          bytes: value.bytes,
        }),
      };
    } catch (error) {
      const value = error as { code?: string };
      if (value.code === "file_conflict")
        return reply
          .code(409)
          .send({ error: value.code, message: (error as Error).message });
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post("/api/files/content", async (request, reply) => {
    const body = request.body as {
      contextId?: string;
      path?: string;
      contentBase64?: string;
      createOnly?: boolean;
    };
    if (
      !body.path ||
      typeof body.contentBase64 !== "string" ||
      body.createOnly !== true
    )
      return reply.code(400).send({ error: "invalid_create" });
    try {
      const filePath = body.path, contentBase64 = body.contentBase64;
      const contextId = body.contextId ?? "local",
        value = await withScopedFiles(contextId, body, request, reply, service => service.createFile(
          { contextId, path: filePath },
          Buffer.from(contentBase64, "base64"),
        ), true);
      return reply
        .code(201)
        .send({
          ...value,
          route: routeEvidence(value.route),
          operation: operationEvidence(
            "file.create.content",
            contextId,
            value.route,
            { path: body.path, bytes: value.bytes },
          ),
        });
    } catch (error) {
      if ((error as { code?: string }).code === "file_conflict")
        return reply
          .code(409)
          .send({ error: "file_conflict", message: (error as Error).message });
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.get("/api/files/stat", async (request, reply) => {
    const query = request.query as { contextId?: string; path?: string };
    if (!query.path) return reply.code(400).send({ error: "path_required" });
    try {
      const contextId = query.contextId ?? 'local';
      const value = await withScopedFiles(contextId, query, request, reply, service => service.stat({ contextId, path: query.path! }, { signal: requestSignal(request, reply) }));
      return {
        ...value,
        route: routeEvidence(value.route),
      };
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.get("/api/files/search", async (request, reply) => {
    const query = request.query as {
      contextId?: string;
      path?: string;
      query?: string;
      mode?: "name" | "content" | "all";
      limit?: string;
      maxEntries?: string;
      maxDepth?: string;
    };
    if (!query.query?.trim()) return { matches: [], route: null };
    const contextId = query.contextId ?? "local";
    try {
      const value = await withScopedFiles(contextId, query, request, reply, service=>service.search({ contextId, path: query.path ?? "/" }, query.query!, {
        mode: query.mode ?? "all",
        limit: Number(query.limit) || 200,
        maxEntries: Number(query.maxEntries) || 5_000,
        maxDepth: Number(query.maxDepth) || 12,
        signal: requestSignal(request, reply),
      }));
      return {
        ...value,
        route: routeEvidence(value.route),
        operation: operationEvidence("file.search", contextId, value.route, {
          path: query.path ?? "/",
          query: query.query,
          mode: query.mode ?? "all",
          matches: value.matches.length,
        }),
      };
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post("/api/files", async (request, reply) => {
    const body = request.body as {
      contextId?: string;
      path?: string;
      type?: "file" | "directory";
      contentBase64?: string;
    };
    if (!body.path || !["file", "directory"].includes(String(body.type)))
      return reply.code(400).send({ error: "invalid_create" });
    try {
      const contextId = body.contextId ?? "local",
        target = { contextId, path: body.path },
        value = await withScopedFiles(contextId, body, request, reply, service =>
          body.type === "directory"
            ? service.createDirectory(target)
            : service.createFile(
                target,
                Buffer.from(body.contentBase64 ?? "", "base64"),
              ), true);
      return reply
        .code(201)
        .send({
          ...value,
          route: routeEvidence(value.route),
          operation: operationEvidence(
            `file.create.${body.type}`,
            contextId,
            value.route,
            { path: body.path },
          ),
        });
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.patch("/api/files", async (request, reply) => {
    const body = request.body as {
      contextId?: string;
      path?: string;
      destination?: string;
    };
    if (!body.path || !body.destination)
      return reply.code(400).send({ error: "invalid_move" });
    try {
      const filePath = body.path, destination = body.destination;
      const contextId = body.contextId ?? "local",
        value = await withScopedFiles(contextId, body, request, reply, service => service.move({ contextId, path: filePath }, destination), true);
      return {
        ...value,
        route: routeEvidence(value.route),
        operation: operationEvidence("file.move", contextId, value.route, {
          path: body.path,
          destination: body.destination,
        }),
      };
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.delete("/api/files", async (request, reply) => {
    const body = request.body as {
      contextId?: string;
      path?: string;
      permanent?: boolean;
      confirm?: boolean;
    };
    if (!body.path) return reply.code(400).send({ error: "path_required" });
    if (body.permanent && body.confirm !== true)
      return reply.code(409).send({ error: "confirmation_required" });
    try {
      const filePath = body.path;
      const contextId = body.contextId ?? "local",
        target = { contextId, path: filePath },
        value = await withScopedFiles(contextId, body, request, reply, service => body.permanent
          ? service.remove(target)
          : service.trash(target), true);
      return {
        ...value,
        permanent: Boolean(body.permanent),
        route: routeEvidence(value.route),
        operation: operationEvidence(
          body.permanent ? "file.delete" : "file.trash",
          contextId,
          value.route,
          {
            path: body.path,
            restorePath: "restorePath" in value ? value.restorePath : undefined,
          },
        ),
      };
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post("/api/files/restore", async (request, reply) => {
    const body = request.body as { contextId?: string; path?: string };
    if (!body.path) return reply.code(400).send({ error: "path_required" });
    try {
      const filePath = body.path;
      const contextId = body.contextId ?? "local",
        value = await withScopedFiles(contextId, body, request, reply, service => service.restore({ contextId, path: filePath }), true);
      return {
        ...value,
        route: routeEvidence(value.route),
        operation: operationEvidence("file.restore", contextId, value.route, {
          path: body.path,
        }),
      };
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.get("/api/search", async (request) => {
    const query = request.query as {
        contextId?: string;
        q?: string;
        limit?: string;
      },
      contextId = String(query.contextId ?? "") || undefined,
      q = String(query.q ?? ""),
      limit = Math.min(250, Math.max(1, Number(query.limit) || 100));
    const wanted = q.toLocaleLowerCase(),
      matches = (value: string) => value.toLocaleLowerCase().includes(wanted);
    const indexed = store
      .search(contextId, q, limit)
      .map((value: any) =>
        value.source === "index"
          ? {
              ...value,
              repositoryRoot: resolveIndex(undefined, value.contextId)?.root,
            }
          : value,
      );
    const databaseItems: any[] = [];
    const projectItems = liveProjects
      .list()
      .filter(
        (item) =>
          (!contextId || item.contextId === contextId) &&
          matches(
            `${item.command} ${item.repositoryPath} ${item.hostname ?? ""} ${item.status}`,
          ),
      )
      .map((item) => ({
        type: "live-project",
        entityId: item.id,
        contextId: item.contextId,
        label: item.repositoryPath.split("/").at(-1) ?? item.repositoryPath,
        path: item.repositoryPath,
        detail: `${item.status} · :${item.port}`,
        source: "live project session",
        rank: 5,
      }));
    const semantic = contextId
      ? worldStore
          .search(contextId, q, limit)
          .map((value: any) => ({
            type: value.kind,
            entityId: value.entityId,
            contextId: value.contextId,
            label: value.label,
            detail: value.workloadLabel
              ? `${value.workloadLabel} · ${value.detail ?? ""}`
              : value.detail,
            workloadId: value.workloadId,
            workloadLabel: value.workloadLabel,
            source: `semantic graph · ${value.namespace}`,
            rank: value.rank,
          }))
      : [];
    const values = [
        ...databaseItems,
        ...projectItems,
        ...indexed,
        ...semantic,
        ...(contextId ? evidence.search(contextId, q, limit) : []),
      ],
      seen = new Set<string>();
    return {
      items: values
        .filter((value: any) => {
          const key = `${value.type}:${value.entityId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, limit),
    };
  });
  // Canonical semantic-world routes.
  app.get("/api/world/projection", async (request, reply) => {
    const query = request.query as {
        contextId?: string;
        rootId?: string;
        lens?: string;
        level?: string;
        budget?: string;
        cursor?: string;
      },
      contextId = String(query.contextId ?? "");
    if (!contextId) return reply.code(400).send({ error: "context_required" });
    try {
      const projection=world.projection(contextId, {
        rootId: query.rootId,
        lens: query.lens ?? "overview",
        level: Number(query.level) || 0,
        budget: Math.min(500, Math.max(1, Number(query.budget) || 100)),
        cursor: query.cursor,
      });
      return {...projection,initialized:Boolean(worldStore.lastGoodAt(contextId)),lastGoodAt:worldStore.lastGoodAt(contextId)??null};
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.get("/api/world/search", async (request, reply) => {
    const query = request.query as {
        contextId?: string;
        q?: string;
        limit?: string;
      },
      contextId = String(query.contextId ?? ""),
      q = String(query.q ?? "").trim();
    if (!contextId || !q) return { items: [], errors: [] };
    try {
      return {
        items: worldStore.search(
          contextId,
          q,
          Math.min(250, Math.max(1, Number(query.limit) || 100)),
        ),
        errors: [],
      };
    } catch (error) {
      return {
        items: [],
        errors: [
          { code: "search_unavailable", message: (error as Error).message },
        ],
      };
    }
  });
  app.get("/api/world/entities/:id", async (request, reply) => {
    const id = decodeURIComponent((request.params as { id: string }).id),
      value = world.detail(id);
    return value ?? reply.code(404).send({ error: "entity_not_found" });
  });
  app.put('/api/world/entities/:id/correction',async(request,reply)=>{
    const id=decodeURIComponent((request.params as {id:string}).id),body=request.body as {contextId?:string;kind?:string;value?:unknown;confirm?:boolean}|undefined;
    if(body?.confirm!==true)return reply.code(409).send({error:'confirmation_required'});
    if(!body?.contextId||!body.kind)return reply.code(400).send({error:'invalid_correction'});
    try{return{corrections:world.putCorrection(body.contextId,id,body.kind as any,body.value)}}catch(error){const message=(error as Error).message;return reply.code(message==='entity_not_found'?404:400).send({error:message})}
  });
  app.delete('/api/world/entities/:id/correction',async(request,reply)=>{
    const id=decodeURIComponent((request.params as {id:string}).id),body=request.body as {contextId?:string;kind?:string;confirm?:boolean}|undefined;
    if(body?.confirm!==true)return reply.code(409).send({error:'confirmation_required'});
    if(!body?.contextId)return reply.code(400).send({error:'context_required'});
    try{return{removed:world.deleteCorrections(body.contextId,id,body.kind as any)}}catch(error){return reply.code(404).send({error:(error as Error).message})}
  });
  app.get("/api/world/entities/:id/neighborhood", async (request, reply) => {
    const id = decodeURIComponent((request.params as { id: string }).id),
      query = request.query as {
        contextId?: string;
        lens?: string;
        level?: string;
        budget?: string;
        cursor?: string;
      },
      contextId = String(query.contextId ?? "");
    if (!contextId) return reply.code(400).send({ error: "context_required" });
    if (!world.detail(id))
      return reply.code(404).send({ error: "entity_not_found" });
    return world.projection(contextId, {
      rootId: id,
      lens: query.lens ?? "overview",
      level: Number(query.level) || 1,
      budget: Math.min(500, Math.max(1, Number(query.budget) || 100)),
      cursor: query.cursor,
    });
  });
  app.get("/api/world/entities/:id/evidence", async (request, reply) => {
    const id = decodeURIComponent((request.params as { id: string }).id),
      value = world.detail(id);
    return value
      ? { entity: value.entity, assertions: value.assertions }
      : reply.code(404).send({ error: "entity_not_found" });
  });
  app.get("/api/world/entities/:id/timeline", async (request, reply) => {
    const id = decodeURIComponent((request.params as { id: string }).id),
      contextId = String(
        (request.query as { contextId?: string }).contextId ?? "",
      );
    if (!contextId) return reply.code(400).send({ error: "context_required" });
    return { items: worldStore.timeline(contextId, id) };
  });
  const listInterpreters = async () => ({
    protocolVersion: "atlas.interpreter.v1",
    items: worldStore.interpreters(),
  });
  const recomputeInterpreters = async (request: any, reply: any) => {
    if (process.env.NODE_ENV === "production")
      return reply.code(403).send({ error: "development_only" });
    const contextId = String(
      (request.body as { contextId?: string })?.contextId ?? "local",
    );
    await refreshWorld(contextId,{force:true});
    return { contextId, interpreters: worldStore.interpreters() };
  };
  app.get("/api/world/interpreters", listInterpreters);
  app.post("/api/world/interpreters/recompute", recomputeInterpreters);
  app.post("/api/world/refresh",async(request,reply)=>{
    const contextId=String((request.body as {contextId?:string})?.contextId??'local');
    try{await refreshWorld(contextId,{force:true});return{contextId,refreshed:true,projection:world.projection(contextId,{lens:'overview',level:0,budget:100})}}catch(error){worldStore.recordRefreshError(contextId,error);return reply.code(503).send({error:'world_refresh_failed',message:'The last complete Observatory remains available.',lastGoodAt:worldStore.lastGoodAt(contextId)??null})}
  });
  const listDeviceAdapters = async () => ({
    protocolVersion: "atlas.device-adapter.v1",
    items: deviceAdapters.map((value) => ({
      id: value.manifest.id,
      version: value.manifest.version,
      publisher: value.manifest.publisher,
      displayName: value.manifest.displayName,
      description: value.manifest.description,
      trusted: value.trusted,
      source: value.source,
      status: value.error ? "error" : "ready",
      error: value.error,
    })),
  });
  const runRegisteredDeviceAdapter = async (request: any, reply: any) => {
    const id = decodeURIComponent((request.params as { id: string }).id),
      body = request.body as { contextId?: string; confirm?: boolean },
      adapter = deviceAdapters.find((value) => value.manifest.id === id);
    if (!adapter) return reply.code(404).send({ error: "adapter_not_found" });
    if (adapter.error)
      return reply
        .code(409)
        .send({ error: "adapter_invalid", message: adapter.error });
    if (body.confirm !== true)
      return reply.code(409).send({ error: "confirmation_required" });
    const contextId = String(body.contextId ?? "local");
    try {
      const result = await runDeviceAdapter(
        adapter.manifest,
        await contexts.commandExecutor(contextId),
        contextId,
      );
      world.ingest(adapter.manifest.interpreter, result.inputs);
      worldRefreshState.delete(contextId);
      return {
        adapterId: id,
        contextId,
        route: "terminal-preferred-command",
        observations: result.inputs.length,
        entities: result.output.entities.length,
        assertions: result.output.assertions.length,
      };
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  };
  app.get("/api/device-adapters", listDeviceAdapters);
  app.post("/api/device-adapters/:id/run", runRegisteredDeviceAdapter);
  app.get("/api/intelligence/capabilities", async () =>
    intelligence.capabilities(),
  );
  app.get("/api/intelligence/context", async (request) => {
    const query = request.query as { contextId?: string; selectionId?: string },
      contextId = String(query.contextId ?? "local");
    return intelligence.context(contextId, query.selectionId);
  });
  app.post("/api/intelligence/analyze", async (request, reply) => {
    const body = request.body as {
        question?: string;
        contextId?: string;
        selectionId?: string;
      },
      contextId = String(body.contextId ?? "local");
    try {
      return await intelligence.analyze(
        String(body.question ?? ""),
        contextId,
        body.selectionId,
        requestSignal(request),
      );
    } catch (error) {
      const value = error as { code?: string; message?: string };
      return reply
        .code(value.code === "calculator_unavailable" ? 503 : 400)
        .send({
          error: value.code ?? "analysis_failed",
          message: value.message,
        });
    }
  });
  app.get("/api/discovery/entities", async (request) => {
    const contextId = String(
      (request.query as { contextId?: string }).contextId ?? "local",
    );
    return {
      entities: evidence.entities(contextId),
      relationships: evidence.relationships(contextId),
    };
  });
  app.get("/api/discovery/scan", { websocket: true }, (socket, request) => {
    const query = request.query as {
        contextId?: string;
        root?: string;
        maxEntries?: string;
        maxDepth?: string;
      },
      contextId = String(query.contextId ?? "local"),
      root = String(query.root ?? "/");
    const controller = new AbortController();
    socket.once("close", () => controller.abort());
    void (async () => {
      const route = await contexts.route(contextId),
        scan = evidence.beginScan({ contextId, routeId: route.id });
      let partial = false;
      const scanner = new HostDiscovery({
        maxEntries: Math.min(
          10_000,
          Math.max(1, Number(query.maxEntries) || 10_000),
        ),
        maxDepth: Math.min(32, Math.max(1, Number(query.maxDepth) || 8)),
      });
      for await (const batch of scanner.scan(
        { id: contextId, route, root },
        controller.signal,
      )) {
        partial ||= batch.partial;
        evidence.putEntities(scan.id, batch.entities);
        if (socket.readyState === socket.OPEN)
          socket.send(
            JSON.stringify({
              type: "discovery_batch",
              scanId: scan.id,
              ...batch,
              route: routeEvidence(route),
            }),
          );
      }
      evidence.completeScan(scan.id, { partial });
      const contextIndex = resolveIndex(undefined, contextId);
      if (contextIndex) {
        const runtimeEdges = correlateRuntime(
          contextIndex,
          evidence.entities(contextId),
        );
        const updated = {
          ...contextIndex,
          edges: [
            ...new Map(
              [...contextIndex.edges, ...runtimeEdges].map((edge: any) => [
                edge.id,
                edge,
              ]),
            ).values(),
          ],
        };
        store.saveIndex(updated);
        if (activeIndex?.id === updated.id) activeIndex = updated;
      }
      if (socket.readyState === socket.OPEN) socket.close(1000);
    })().catch((error) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "error",
            code: (error as { code?: string }).code ?? "discovery_failed",
            message: (error as Error).message,
          }),
        );
        socket.close(1011);
      }
    });
  });
  app.get(
    "/api/analysis/repository",
    { websocket: true },
    (socket, request) => {
      const query = request.query as { contextId?: string; path?: string },
        contextId = query.contextId ?? "local";
      if (!query.path) {
        socket.send(
          JSON.stringify({ type: "error", code: "repository_path_required" }),
        );
        socket.close(1008);
        return;
      }
      const repositoryPath = query.path;
      const controller = new AbortController();
      socket.once("close", () => controller.abort());
      void (async () => {
        const revision = await revisionFor(contextId, repositoryPath),
          files = await contexts.files(contextId);
        for await (const batch of analyzeRepository(
          { contextId, path: repositoryPath, revision },
          files,
          controller.signal,
        )) {
          if (batch.complete) {
            const covered = await new CoverageService(files).ingest({
              contextId,
              repositoryPath,
              index: batch.index,
              revision,
            });
            const runtimeEdges = correlateRuntime(
              covered.index,
              evidence.entities(contextId),
            );
            activeIndex = {
              ...covered.index,
              edges: [
                ...new Map(
                  [...covered.index.edges, ...runtimeEdges].map((edge: any) => [
                    edge.id,
                    edge,
                  ]),
                ).values(),
              ],
            };
            store.saveIndex(activeIndex);
            if (socket.readyState === socket.OPEN)
              socket.send(
                JSON.stringify({
                  type: "analysis_complete",
                  index: {
                    id: activeIndex.id,
                    root: activeIndex.root,
                    revision: activeIndex.revision,
                    summary: activeIndex.summary,
                  },
                  coverage: covered.artifact,
                }),
              );
          } else if (socket.readyState === socket.OPEN)
            socket.send(
              JSON.stringify({
                type: "analysis_batch",
                nodes: batch.nodes,
                edges: batch.edges,
              }),
            );
        }
        if (socket.readyState === socket.OPEN) socket.close(1000);
      })().catch((error) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(
            JSON.stringify({
              type: "error",
              code: (error as { code?: string }).code ?? "analysis_failed",
              message: (error as Error).message,
            }),
          );
          socket.close(1011);
        }
      });
    },
  );

  const revisionFor = async (contextId: string, repositoryPath: string) => {
    try {
      const commandPath = await contexts.commandPath(contextId, repositoryPath),
        result = await (
          await contexts.commandExecutor(contextId)
        ).execute(`git -C ${posixQuote(commandPath)} rev-parse HEAD`);
      return result.exitCode === 0
        ? result.output.toString("utf8").trim().split(/\r?\n/).at(-1)
        : undefined;
    } catch {
      return undefined;
    }
  };
  app.get("/api/coverage/commands", async (request, reply) => {
    const query = request.query as {
      contextId?: string;
      repositoryPath?: string;
    };
    if (!query.repositoryPath)
      return reply.code(400).send({ error: "repository_path_required" });
    try {
      const opened = await (
        await contexts.files(query.contextId ?? "local")
      ).read({
        contextId: query.contextId ?? "local",
        path: path.posix.join(query.repositoryPath, "package.json"),
      });
      try {
        return {
          commands: coverageCommands(
            opened.text ? JSON.parse(opened.text) : {},
          ),
          errors: [],
        };
      } catch {
        return {
          commands: [],
          errors: [
            {
              code: "invalid_package_manifest",
              message:
                "Coverage commands are unavailable because package.json is not valid JSON.",
            },
          ],
        };
      }
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post("/api/coverage/ingest", async (request, reply) => {
    const body = request.body as {
        contextId?: string;
        repositoryPath?: string;
        revision?: string;
        indexId?: string;
      },
      contextId = body.contextId ?? "local",
      index = resolveIndex(body.indexId, contextId);
    if (!index) return reply.code(404).send({ error: "no_index_for_context" });
    if (!body.repositoryPath)
      return reply.code(400).send({ error: "repository_path_required" });
    try {
      const revision =
          body.revision ?? (await revisionFor(contextId, body.repositoryPath)),
        result = await new CoverageService(
          await contexts.files(contextId),
        ).ingest({
          contextId,
          repositoryPath: body.repositoryPath,
          index,
          revision,
        });
      store.saveIndex(result.index);
      if (activeIndex?.id === result.index.id) activeIndex = result.index;
      return {
        artifact: result.artifact,
        evidence: result.evidence
          ? {
              format: result.evidence.format,
              source: result.evidence.source,
              revision: result.evidence.revision,
              collectedAt: result.evidence.collectedAt,
              files: Object.keys(result.evidence.files).length,
            }
          : null,
        revision,
        summary: {
          functions: result.index.nodes.filter(
            (node: any) =>
              node.type === "function" && node.coverage && !node.coverage.stale,
          ).length,
        },
      };
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });
  app.post("/api/coverage/refresh", async (request, reply) => {
    const body = request.body as {
        contextId?: string;
        repositoryPath?: string;
        command?: string;
        indexId?: string;
      },
      contextId = body.contextId ?? "local",
      command = String(body.command ?? "").trim(),
      index = resolveIndex(body.indexId, contextId);
    if (!index) return reply.code(404).send({ error: "no_index_for_context" });
    if (!body.repositoryPath || !command || command.length > 16_000)
      return reply.code(400).send({ error: "invalid_coverage_run" });
    try {
      const started = Date.now(),
        commandPath = await contexts.commandPath(
          contextId,
          body.repositoryPath,
        ),
        result = await (
          await contexts.commandExecutor(contextId)
        ).execute(`cd ${posixQuote(commandPath)} && ${command}`, {
          timeoutMs: 30 * 60_000,
        });
      const revision = await revisionFor(contextId, body.repositoryPath),
        coverage = await new CoverageService(
          await contexts.files(contextId),
        ).ingest({
          contextId,
          repositoryPath: body.repositoryPath,
          index,
          revision,
          revisionVerified: result.exitCode === 0,
        });
      store.saveIndex(coverage.index);
      if (activeIndex?.id === coverage.index.id) activeIndex = coverage.index;
      const run = {
        id: randomUUID(),
        symbolId: `coverage:${contextId}:${body.repositoryPath}`,
        mode: "coverage",
        status: result.exitCode === 0 ? "succeeded" : "failed",
        durationMs: Date.now() - started,
        summary: {
          command: redactCommandLine(command),
          exitCode: result.exitCode,
          artifact: coverage.artifact,
          revision,
        },
      };
      store.saveRun(run);
      return {
        run,
        output: result.output.toString("utf8"),
        coverage: {
          artifact: coverage.artifact,
          revision,
          verified: result.exitCode === 0,
        },
      };
    } catch (error) {
      const result = processError(error);
      return reply.code(result.statusCode).send(result.body);
    }
  });

  app.get("/api/fngk/terminals", { websocket: true }, (socket, request) => {
    const query = request.query as {
      target?: string;
      new?: string;
      session?: string;
      profile?: string;
    };
    const target = String(query.target ?? "").trim();
    let closed = false;
    socket.once('close', () => { closed = true; });
    void (async () => {
      if (!target.startsWith('device:')) throw Object.assign(new Error('A Device target is required.'), { code: 'target_required' });
      const scope = await scopeForContext(target, query.profile, request);
      const sessionId=typeof query.session==='string'&&query.session.trim()?query.session.trim():undefined;
      const remembered=sessionId?atlasUserTerminals.get(sessionId):undefined;
      if(sessionId&&(!remembered||remembered.deviceId!==scope.deviceId||remembered.profile!==scope.profile))throw Object.assign(new Error('Atlas can restore only its own terminal for this Device and profile.'),{code:'terminal_session_unavailable'});
      const terminal=fngk.openTerminal(target,{newSession:!sessionId,sessionId,profile:scope.profile,owner:'atlas-user',purpose:'interactive'});
      const onEvent=(event:TerminalInput|any)=>{if(event.type==='ready'&&terminal.sessionId)atlasUserTerminals.set(terminal.sessionId,{deviceId:scope.deviceId,profile:scope.profile,owner:'atlas-user',purpose:'interactive'});if(socket.readyState===socket.OPEN)socket.send(JSON.stringify(event));if(event.type==='detached'&&socket.readyState===socket.OPEN)socket.close(1000)};
      terminal.on('event',onEvent);terminal.once('error',(error)=>{if(socket.readyState===socket.OPEN)socket.send(JSON.stringify({type:'error',code:error.code??'terminal_unavailable',message:error.message}))});
      if(closed){terminal.close();return;}
      socket.on("message", (raw: RawData) => {
        void (async () => {
          try {
            const message = JSON.parse(raw.toString()) as TerminalInput;
            if (!message || !terminalInputs.has(message.type)) throw new Error("unsupported terminal message");
            if (!terminal.send(message)) throw Object.assign(new Error('Terminal session is closed.'), { code: 'terminal_closed' });
          } catch (error) {
            if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'error', code: (error as { code?: string }).code ?? 'invalid_input', message: (error as Error).message }));
          }
        })();
      });
      socket.once("close", () => { terminal.detach('atlas-user-panel-closed'); });
    })().catch(error => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'error', code: (error as { code?: string }).code ?? 'terminal_unavailable', message: (error as Error).message }));
      socket.close(1008);
    });
  });

  app.post("/api/fngk/update", async (request, reply) => {
    if ((request.body as { confirm?: boolean } | undefined)?.confirm !== true)
      return reply.code(409).send({ error: "confirmation_required" });
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
    });
    const emit = (value: Record<string, unknown>) =>
      reply.raw.write(`${JSON.stringify(value)}\n`);
    try {
      const signal = requestSignal(request);
      await fngk.update((line) => emit({ type: "output", line }), signal);
      emit({ type: "complete", context: await fngk.probe(undefined, signal) });
    } catch (error) {
      const result = processError(error);
      emit({ type: "error", ...result.body });
    } finally {
      reply.raw.end();
    }
  });

  app.get("/api/state", async (request) => {
    const query=request.query as {contextId?:string;fngk?:string},
      contextId =
        String(query.contextId ?? "") ||
        undefined,
      index = resolveIndex(undefined, contextId);
    return {
      ...(query.fngk==='0'?{}:{fngk:await fngk.probe()}),
      index: index
        ? {
            id: index.id,
            root: index.root,
            contextId: index.contextId,
            revision: index.revision,
            summary: index.summary,
          }
        : null,
      indexes: store.indexes(contextId),
      runs: store.runs(),
    };
  });
  app.post("/api/index", async (request, reply) => {
    const body = request.body as { root?: string; maxFiles?: number };
    const target = String(body?.root ?? "");
    if (!path.isAbsolute(target))
      return reply.code(400).send({ error: "root_must_be_absolute" });
    try {
      activeIndex = await observeLocalProcesses(
        await analyze(target, { maxFiles: Number(body.maxFiles) || 6000 }),
      );
      store.saveIndex(activeIndex);
      return {
        id: activeIndex.id,
        root: activeIndex.root,
        summary: activeIndex.summary,
      };
    } catch (error) {
      return reply
        .code(400)
        .send({ error: "analysis_failed", message: (error as Error).message });
    }
  });
  app.get("/api/software/functions", async (request, reply) => {
    const query = request.query as {
        contextId?: string;
        indexId?: string;
        limit?: string;
      },
      contextId = String(query.contextId ?? ""),
      index = resolveIndex(query.indexId, contextId || undefined);
    if (!contextId)
      return reply.code(400).send({ error: "context_required" });
    if (!index)
      return reply.code(404).send({ error: "index_not_found" });
    return projectSoftwareFunctions(index, Number(query.limit) || 500);
  });
  app.get("/api/nodes/:id", async (request, reply) => {
    const id = (request.params as { id: string }).id,
      query = request.query as { indexId?: string; contextId?: string },
      index = resolveIndex(query.indexId, query.contextId),
      node = index?.nodes.find((item: any) => item.id === id);
    if (!node) return reply.code(404).send({ error: "node_not_found" });
    return {
      node,
      incoming: index.edges
        .filter((edge: any) => edge.target === node.id)
        .slice(0, 100),
      outgoing: index.edges
        .filter((edge: any) => edge.source === node.id)
        .slice(0, 100),
    };
  });
  app.post("/api/layout", async (request, reply) => {
    if (!activeIndex) return reply.code(404).send({ error: "no_active_index" });
    const positions = Array.isArray((request.body as any)?.positions)
      ? (request.body as any).positions
          .filter(
            (position: any) =>
              typeof position.id === "string" &&
              Number.isFinite(position.x) &&
              Number.isFinite(position.y),
          )
          .slice(0, 10000)
      : [];
    store.saveLayout(activeIndex.id, positions);
    return { saved: positions.length };
  });
  app.post("/api/run", async (request, reply) => {
    const body = request.body as any;
    const index = resolveIndex(body?.indexId, body?.contextId);
    if (!index) return reply.code(404).send({ error: "no_index_for_context" });
    if (body?.consent !== true)
      return reply.code(409).send({ error: "operation_consent_required" });
    try {
      let run: any;
      if ((index.contextId ?? "local") === "local")
        run = await runFunction(index, String(body.symbolId), body);
      else {
        const fn = index.nodes.find(
            (node: any) =>
              node.id === String(body.symbolId) && node.type === "function",
          ),
          extension = path.posix.extname(fn?.path ?? "");
        if (!fn)
          throw new Error(
            "Function was not found in the selected repository index.",
          );
        if (
          ![".js", ".mjs", ".cjs"].includes(extension) ||
          fn.exported !== true
        )
          throw new Error(
            "Remote execution is available only for exported JavaScript functions with serializable arguments. Run the containing test or open a terminal for this symbol instead.",
          );
        const source = path.posix.join(index.root, fn.path),
          script =
            "import {pathToFileURL} from 'node:url';const [source,name,raw]=process.argv.slice(1);const mod=await import(pathToFileURL(source));if(typeof mod[name]!=='function')throw new Error('Symbol is not an exported function');console.log(JSON.stringify({returnValue:await mod[name](...JSON.parse(raw))},null,2));",
          command = `cd ${posixQuote(await contexts.commandPath(index.contextId, index.root))} && node --input-type=module -e ${posixQuote(script)} ${posixQuote(source)} ${posixQuote(fn.name)} ${posixQuote(JSON.stringify(body.args ?? []))}`,
          started = Date.now(),
          result = await (
            await contexts.commandExecutor(index.contextId)
          ).execute(command, {
            timeoutMs: Math.min(
              30_000,
              Math.max(100, Number(body.timeoutMs) || 5_000),
            ),
          });
        run = {
          id: randomUUID(),
          symbolId: fn.id,
          mode: "fngk-terminal",
          status: result.exitCode === 0 ? "completed" : "failed",
          exitCode: result.exitCode,
          stdout: result.output.toString("utf8"),
          stderr: "",
          truncated: false,
          durationMs: Date.now() - started,
          evidence: {
            classification: "executed",
            contextId: index.contextId,
            route: "fngk-terminal",
            revision: index.revision ?? null,
          },
        };
      }
      store.saveRun({
        ...run,
        summary: {
          truncated: run.truncated,
          exitCode: run.exitCode,
          evidence: run.evidence,
        },
      });
      return run;
    } catch (error) {
      const run = {
        id: randomUUID(),
        symbolId: String(body?.symbolId ?? ""),
        mode: "disposable",
        status: "unavailable",
        summary: { message: (error as Error).message },
      };
      store.saveRun(run);
      return reply
        .code(409)
        .send({
          error: "run_unavailable",
          message: (error as Error).message,
          run,
        });
    }
  });

  const webRoot = path.join(root, "web-dist");
  if (existsSync(webRoot))
    await app.register(staticFiles, { root: webRoot, wildcard: true });
  else
    app.get("/", async (_request, reply) =>
      reply
        .code(503)
        .type("text/plain")
        .send("Atlas web assets are not built. Run npm run build."),
    );
  return app;
}

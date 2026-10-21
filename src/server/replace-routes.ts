import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { FileService } from '../files/file-service.js';
import { FileConflictError } from '../files/file-service.js';
import { applyHunks, compileQuery, computeHunks, parseGlobs, type ReplaceQuery } from '../files/text-query.js';
import { validSlot } from '../files/versions.js';

type RawRequest = { raw: NodeJS.EventEmitter };
type RawReply = { raw: NodeJS.EventEmitter & { writableEnded?: boolean } };
type Route = { id: string; kind: string; deviceId?: string; effectiveIdentity: string; privilege: string; observedAt: string; operations?: string[] };

export interface ReplaceRouteDependencies {
  withScopedFiles: <T>(contextId: string, claims: Record<string, unknown>, request: RawRequest, reply: RawReply, operation: (service: FileService) => Promise<T>, mutation?: boolean) => Promise<T>;
  processError: (error: unknown) => { statusCode: number; body: Record<string, unknown> };
  requestSignal: (request: RawRequest, reply?: RawReply) => AbortSignal;
  routeEvidence: (route: Route) => unknown;
  operationEvidence: (type: string, contextId: string, route: Route, summary?: Record<string, unknown>) => unknown;
}

/** Caps for one replace preview. */
export const REPLACE_LIMITS = { files: 200, fileBytes: 2 * 1024 * 1024, hunksPerFile: 2_000, edits: 200 } as const;

interface QueryBody { contextId?: string; root?: string; query?: string; replacement?: string; regex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; include?: unknown; exclude?: unknown; limit?: number }
const flags = (body: QueryBody): ReplaceQuery => ({ query: String(body.query ?? ''), replacement: String(body.replacement ?? ''), regex: body.regex === true, caseSensitive: body.caseSensitive === true, wholeWord: body.wholeWord === true });
const root = (value: unknown) => typeof value === 'string' && value.startsWith('/') ? path.posix.normalize(value) : '/';
const badRequest = (code: string) => ['invalid_pattern', 'invalid_version', 'invalid_path', 'invalid_replace'].includes(code);

export function registerReplaceRoutes(app: FastifyInstance, deps: ReplaceRouteDependencies): void {
  const fail = (reply: { code(status: number): { send(body: unknown): unknown } }, error: unknown) => {
    const code = (error as { code?: string }).code ?? '';
    if (error instanceof FileConflictError || code === 'file_conflict') return reply.code(409).send({ error: 'file_conflict', message: (error as Error).message });
    if (badRequest(code)) return reply.code(400).send({ error: code, message: (error as Error).message });
    const result = deps.processError(error); return reply.code(result.statusCode).send(result.body);
  };

  // Content search for the Search panel: flags, globs and columns, grouped by file.
  app.post('/api/files/find', async (request, reply) => {
    const body = (request.body ?? {}) as QueryBody, contextId = body.contextId ?? 'local';
    try {
      const query = flags(body); compileQuery(query);
      const limit = Math.min(2_000, Math.max(1, Number(body.limit) || 1_000));
      const value = await deps.withScopedFiles(contextId, body as Record<string, unknown>, request, reply, service => service.search({ contextId, path: root(body.root) }, query.query, { mode: 'content', regex: query.regex, caseSensitive: query.caseSensitive, wholeWord: query.wholeWord, include: parseGlobs(body.include), exclude: parseGlobs(body.exclude), limit: Math.min(500, limit), maxMatchesPerFile: 100, maxEntries: 20_000, maxDepth: 32, maxFileBytes: REPLACE_LIMITS.fileBytes, signal: deps.requestSignal(request, reply) }));
      const files = new Map<string, Array<{ line: number; column: number; length: number; preview: string }>>();
      for (const match of value.matches) if (match.type === 'file' && match.line) { const list = files.get(match.path) ?? []; list.push({ line: match.line, column: match.column ?? 1, length: match.length ?? 0, preview: match.preview ?? '' }); files.set(match.path, list); }
      return { files: [...files].map(([filePath, matches]) => ({ path: filePath, matches })), matches: value.matches.length, truncated: value.matches.length >= Math.min(500, limit), route: deps.routeEvidence(value.route) };
    } catch (error) { return fail(reply, error); }
  });

  // Reads the candidate files through FileService and returns every hunk with
  // the fingerprint it was computed against.
  app.post('/api/files/replace/preview', async (request, reply) => {
    const body = (request.body ?? {}) as QueryBody, contextId = body.contextId ?? 'local';
    try {
      const query = flags(body); compileQuery(query);
      const signal = deps.requestSignal(request, reply);
      return await deps.withScopedFiles(contextId, body as Record<string, unknown>, request, reply, async service => {
        const found = await service.search({ contextId, path: root(body.root) }, query.query, { mode: 'content', filesOnly: true, regex: query.regex, caseSensitive: query.caseSensitive, wholeWord: query.wholeWord, include: parseGlobs(body.include), exclude: parseGlobs(body.exclude), limit: 5_000, maxEntries: 20_000, maxDepth: 32, maxFileBytes: REPLACE_LIMITS.fileBytes, signal });
        const candidates = [...new Set(found.matches.filter(match => match.type === 'file').map(match => match.path))].sort();
        const files: Array<{ path: string; fingerprint: string; bytes: number; hunks: ReturnType<typeof computeHunks>; truncated: boolean }> = [], skipped: Array<{ path: string; reason: string; message?: string }> = [];
        for (const filePath of candidates.slice(REPLACE_LIMITS.files)) skipped.push({ path: filePath, reason: 'file_limit' });
        for (const filePath of candidates.slice(0, REPLACE_LIMITS.files)) {
          if (signal.aborted) throw Object.assign(new Error('The preview was cancelled.'), { code: 'cancelled' });
          try {
            const value = await service.read({ contextId, path: filePath }, { signal });
            if (value.tooLarge || value.bytes > REPLACE_LIMITS.fileBytes) { skipped.push({ path: filePath, reason: 'too_large' }); continue; }
            if (value.binary || typeof value.text !== 'string' || !value.fingerprint) { skipped.push({ path: filePath, reason: 'binary' }); continue; }
            const hunks = computeHunks(value.text, query, { limit: REPLACE_LIMITS.hunksPerFile + 1 });
            if (hunks.length) files.push({ path: filePath, fingerprint: value.fingerprint, bytes: value.bytes, hunks: hunks.slice(0, REPLACE_LIMITS.hunksPerFile), truncated: hunks.length > REPLACE_LIMITS.hunksPerFile });
          } catch (error) { if ((error as { code?: string }).code === 'cancelled') throw error; skipped.push({ path: filePath, reason: 'unreadable', message: (error as Error).message }); }
        }
        return { files, skipped, totalHunks: files.reduce((total, file) => total + file.hunks.length, 0), limits: REPLACE_LIMITS, route: deps.routeEvidence(found.route) };
      });
    } catch (error) { return fail(reply, error); }
  });

  // Re-reads each file, re-applies only the selected hunks, and writes through
  // the guarded save so versions rotate. Never partially fails a file.
  app.post('/api/files/replace/apply', async (request, reply) => {
    const body = (request.body ?? {}) as QueryBody & { edits?: Array<{ path?: string; expectedFingerprint?: string; selectedHunks?: unknown }> }, contextId = body.contextId ?? 'local';
    try {
      const query = flags(body); compileQuery(query);
      const edits = Array.isArray(body.edits) ? body.edits : [];
      if (!edits.length || edits.length > REPLACE_LIMITS.edits || edits.some(edit => typeof edit.path !== 'string' || typeof edit.expectedFingerprint !== 'string' || !Array.isArray(edit.selectedHunks))) throw Object.assign(new Error(`Provide between 1 and ${REPLACE_LIMITS.edits} edits with a path, expectedFingerprint and selectedHunks.`), { code: 'invalid_replace' });
      const signal = deps.requestSignal(request, reply);
      return await deps.withScopedFiles(contextId, body as Record<string, unknown>, request, reply, async service => {
        const results: Array<Record<string, unknown>> = [];
        let route: Route | undefined;
        for (const edit of edits) {
          const target = { contextId, path: edit.path! }, selected = (edit.selectedHunks as unknown[]).map(Number).filter(Number.isInteger);
          try {
            const current = await service.read(target, { signal });
            if (current.fingerprint !== edit.expectedFingerprint || typeof current.text !== 'string') { results.push({ path: edit.path, status: 'conflict', message: 'The file changed after the preview.' }); continue; }
            const hunks = computeHunks(current.text, query, { limit: REPLACE_LIMITS.hunksPerFile });
            if (selected.some(id => !hunks.some(hunk => hunk.id === id))) { results.push({ path: edit.path, status: 'conflict', message: 'The preview no longer matches this file.' }); continue; }
            const next = applyHunks(current.text, hunks, selected);
            if (!next.applied) { results.push({ path: edit.path, status: 'ok', applied: 0, fingerprint: current.fingerprint, previousFingerprint: current.fingerprint }); continue; }
            const written = await service.write(target, Buffer.from(next.text), edit.expectedFingerprint!, { signal });
            route = written.route;
            results.push({ path: edit.path, status: 'ok', applied: next.applied, fingerprint: written.fingerprint, previousFingerprint: edit.expectedFingerprint, versioned: written.versioned, bytes: written.bytes });
          } catch (error) {
            if (error instanceof FileConflictError) results.push({ path: edit.path, status: 'conflict', message: error.message });
            else if ((error as { code?: string }).code === 'cancelled') throw error;
            else results.push({ path: edit.path, status: 'failed', error: (error as { code?: string }).code ?? 'failed', message: (error as Error).message });
          }
        }
        const summary = { ok: results.filter(value => value.status === 'ok').length, conflict: results.filter(value => value.status === 'conflict').length, failed: results.filter(value => value.status === 'failed').length };
        return { results, summary, ...(route ? { route: deps.routeEvidence(route), operation: deps.operationEvidence('file.replace', contextId, route, { files: results.length, ...summary, query: query.query }) } : {}) };
      }, true);
    } catch (error) { return fail(reply, error); }
  });

  app.get('/api/files/versions', async (request, reply) => {
    const query = request.query as { contextId?: string; path?: string }, contextId = query.contextId ?? 'local';
    if (!query.path) return reply.code(400).send({ error: 'path_required' });
    try {
      const value = await deps.withScopedFiles(contextId, query, request, reply, service => service.versions({ contextId, path: query.path! }, { signal: deps.requestSignal(request, reply) }));
      return { path: value.path, versions: value.versions, route: deps.routeEvidence(value.route) };
    } catch (error) { return fail(reply, error); }
  });

  app.get('/api/files/versions/content', async (request, reply) => {
    const query = request.query as { contextId?: string; path?: string; slot?: string }, contextId = query.contextId ?? 'local';
    if (!query.path) return reply.code(400).send({ error: 'path_required' });
    try {
      const slot = validSlot(query.slot);
      const value = await deps.withScopedFiles(contextId, query, request, reply, service => service.readVersion({ contextId, path: query.path! }, slot, { signal: deps.requestSignal(request, reply) }));
      return { path: value.path, slot, version: value.version, fingerprint: value.fingerprint, binary: value.binary, text: value.binary ? undefined : value.content.toString('utf8'), contentBase64: value.binary ? value.content.toString('base64') : undefined, route: deps.routeEvidence(value.route) };
    } catch (error) { return fail(reply, error); }
  });

  app.post('/api/files/versions/restore', async (request, reply) => {
    const body = (request.body ?? {}) as { contextId?: string; path?: string; slot?: number; versionFingerprint?: string; expectedFingerprint?: string }, contextId = body.contextId ?? 'local';
    if (!body.path) return reply.code(400).send({ error: 'path_required' });
    try {
      const selector = body.versionFingerprint ? { versionFingerprint: String(body.versionFingerprint) } : { slot: validSlot(body.slot) };
      const value = await deps.withScopedFiles(contextId, body as Record<string, unknown>, request, reply, service => service.restoreVersion({ contextId, path: body.path! }, selector, body.expectedFingerprint, { signal: deps.requestSignal(request, reply) }), true);
      return { path: value.path, fingerprint: value.fingerprint, previousFingerprint: value.previousFingerprint, bytes: value.bytes, restoredSlot: value.restoredSlot, restoredFingerprint: value.restoredFingerprint, route: deps.routeEvidence(value.route), operation: deps.operationEvidence('file.version.restore', contextId, value.route, { path: body.path, slot: value.restoredSlot }) };
    } catch (error) { return fail(reply, error); }
  });
}

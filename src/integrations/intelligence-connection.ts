import { createHash } from 'node:crypto';
import { DEFAULT_INTELLIGENCE_URL, DEFAULT_INTELLIGENCE_WORKSPACE, IntelligenceServiceProvider } from '../intelligence/service.js';
import { LocalCredentialStore } from './local-credential-store.js';

export type IntelligenceConnectionStatus = {
  configured: boolean; source: 'stored' | 'environment' | null; origin: string; workspaceId: string; keyHint?: string;
};
type Meta = { origin: string; workspaceId: string };

/** A refusal whose message is fixed text: it never contains the submitted key. */
export class IntelligenceConnectionError extends Error {
  constructor(readonly code: 'intelligence_connection_invalid' | 'intelligence_key_rejected' | 'intelligence_unreachable', message: string) { super(message); }
}

const KEY_SHAPE = /^isc_[A-Za-z0-9._~+/=-]{12,200}$/, WORKSPACE_SHAPE = /^[A-Za-z0-9._-]{1,64}$/;
const fingerprint = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 8);
const invalid = (message: string) => new IntelligenceConnectionError('intelligence_connection_invalid', message);
const isLocalHost = (host: string) => host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]';

export function normalizeIntelligenceOrigin(input: string) {
  let url: URL; try { url = new URL(input); } catch { throw invalid('Intelligence URL must be an HTTPS origin.'); }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHost(url.hostname));
  if (!secure || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw invalid('Intelligence URL must be an HTTPS origin (HTTP only for localhost) without credentials, path or query.');
  return url.origin;
}

/**
 * The Nipate Intelligence service key for this Atlas installation. A key the user entered is verified with the
 * provider's health check (GET /exec/models: valid key only, no run budget) and then kept encrypted on the local
 * service; the renderer only ever sees status(). ATLAS_INTELLIGENCE_KEY remains the fallback for headless and dev
 * use, but a stored connection wins.
 */
export class IntelligenceConnectionService {
  #store: LocalCredentialStore;
  constructor(databaseFile: string, private readonly env: Record<string, string | undefined> = process.env) {
    this.#store = new LocalCredentialStore(LocalCredentialStore.locate(databaseFile, 'intelligence-connection.json', '.atlas-intelligence-connection.test.json'));
  }
  #stored(): { key: string; origin: string; workspaceId: string } | null {
    const meta = this.#store.load<Meta>(), key = this.#store.secret();
    return meta && key ? { key, origin: meta.origin, workspaceId: meta.workspaceId } : null;
  }
  #environment() {
    const key = this.env.ATLAS_INTELLIGENCE_KEY?.trim();
    return key ? { key, origin: this.env.ATLAS_INTELLIGENCE_URL?.trim() || DEFAULT_INTELLIGENCE_URL, workspaceId: this.env.ATLAS_INTELLIGENCE_WORKSPACE?.trim() || DEFAULT_INTELLIGENCE_WORKSPACE } : null;
  }
  status(): IntelligenceConnectionStatus {
    const stored = this.#stored(), active = stored ?? this.#environment();
    if (!active) return { configured: false, source: null, origin: DEFAULT_INTELLIGENCE_URL, workspaceId: DEFAULT_INTELLIGENCE_WORKSPACE };
    return { configured: true, source: stored ? 'stored' : 'environment', origin: active.origin.replace(/\/+$/, ''), workspaceId: active.workspaceId, keyHint: fingerprint(active.key) };
  }
  /** The provider for the current connection (stored, else environment), resolved on every call. */
  provider() {
    const active = this.#stored() ?? this.#environment();
    return active ? new IntelligenceServiceProvider(active) : undefined;
  }
  bearer() { return (this.#stored() ?? this.#environment())?.key ?? null; }
  async connect(input: { key?: unknown; origin?: unknown; workspaceId?: unknown }) {
    const key = typeof input.key === 'string' ? input.key : '';
    if (!KEY_SHAPE.test(key)) throw invalid('Enter a valid Intelligence service key (it starts with isc_ and has no spaces).');
    const origin = normalizeIntelligenceOrigin(typeof input.origin === 'string' && input.origin.trim() ? input.origin.trim() : DEFAULT_INTELLIGENCE_URL);
    const workspace = typeof input.workspaceId === 'string' && input.workspaceId.trim() ? input.workspaceId.trim() : DEFAULT_INTELLIGENCE_WORKSPACE;
    if (!WORKSPACE_SHAPE.test(workspace)) throw invalid('Workspace id may use letters, digits, dot, dash and underscore (1 to 64 characters).');
    const health = await new IntelligenceServiceProvider({ origin, key, workspaceId: workspace }).health();
    if (!health.available) {
      if (health.status === 401 || health.status === 403) throw new IntelligenceConnectionError('intelligence_key_rejected', 'Intelligence rejected this key. Check that it is active and has the agents:execute scope.');
      throw new IntelligenceConnectionError('intelligence_unreachable', `Could not verify the key with Intelligence at ${origin}. Check the URL and your connection.`);
    }
    this.#store.save(key, { origin, workspaceId: workspace });
    return this.status();
  }
  disconnect() { this.#store.clear(); return this.status(); }
}

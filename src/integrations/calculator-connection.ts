import { createHash, randomBytes } from 'node:crypto';
import { LocalCredentialStore } from './local-credential-store.js';

export interface CalculatorConnection { origin: string; connectionId: string; name: string; expiresAt: string; capabilities: string[]; }
type Pending = { origin: string; verifier: string; redirectUri: string; expiresAt: number };

function normalizeOrigin(input: string) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Calculator URL must be an HTTPS origin.');
  return url.origin;
}

/**
 * Keeps the Calculator bearer credential on the local Atlas service. The
 * renderer only ever sees connection metadata. The encryption key is a
 * per-installation, owner-only file; desktop hosts may supply
 * ATLAS_CREDENTIAL_KEY to bind this to an OS credential store in a future
 * platform adapter without changing the protocol.
 */
export class CalculatorConnectionService {
  #store: LocalCredentialStore; #pending = new Map<string, Pending>();
  constructor(databaseFile: string, private readonly callbackOrigin: string, private readonly request: typeof fetch = fetch) {
    this.#store = new LocalCredentialStore(LocalCredentialStore.locate(databaseFile, 'calculator-connection.json', '.atlas-calculator-connection.test.json'));
  }
  status() { const value=this.#store.load<{connection:CalculatorConnection}>(); return value?.connection ? { configured:true, connection:value.connection } : { configured:false, connection:null }; }
  bearer() { return this.#store.secret(); }
  begin(input: { origin: string; clientId?: string; appName?: string }) {
    const origin=normalizeOrigin(input.origin), state=randomBytes(32).toString('base64url'), verifier=randomBytes(48).toString('base64url'), challenge=createHash('sha256').update(verifier).digest('base64url'), redirectUri=`${this.callbackOrigin}/api/app-connections/callback`, clientId=input.clientId ?? 'atlas-desktop';
    this.#pending.set(state,{origin,verifier,redirectUri,expiresAt:Date.now()+5*60_000});
    const authorization=new URL('/api/app-connections/authorize',origin); authorization.searchParams.set('client_id',clientId);authorization.searchParams.set('app_name',input.appName ?? 'FNGK Atlas');authorization.searchParams.set('redirect_uri',redirectUri);authorization.searchParams.set('state',state);authorization.searchParams.set('code_challenge',challenge);authorization.searchParams.set('code_challenge_method','S256');
    return { authorizationUrl:authorization.toString(), state };
  }
  async complete(input: { code?: string; state?: string }) {
    const pending=input.state ? this.#pending.get(input.state) : undefined; this.#pending.delete(input.state ?? '');
    if (!pending || pending.expiresAt < Date.now() || !input.code) throw new Error('This app connection callback is invalid or has expired. Start the connection again.');
    const response=await this.request(`${pending.origin}/api/app-connections/token`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({code:input.code,code_verifier:pending.verifier,client_id:'atlas-desktop',redirect_uri:pending.redirectUri})});
    const value=await response.json() as {token?:string;record?:Partial<CalculatorConnection>&{id?:string};message?:string}; if(!response.ok || !value.token || !value.record?.id) throw new Error(value.message ?? 'Calculator rejected the connection exchange.');
    const connection:CalculatorConnection={origin:pending.origin,connectionId:value.record.id,name:value.record.name ?? 'FNGK Atlas',expiresAt:value.record.expiresAt ?? '',capabilities:value.record.capabilities ?? []};this.#store.save(value.token,{connection}); return this.status();
  }
  disconnect() { this.#store.clear(); return { configured:false, connection:null }; }
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface CalculatorConnection { origin: string; connectionId: string; name: string; expiresAt: string; capabilities: string[]; }
type Stored = { connection: CalculatorConnection; ciphertext: string; iv: string; tag: string };
type Pending = { origin: string; verifier: string; redirectUri: string; expiresAt: number };

function normalizeOrigin(input: string) {
  const url = new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Calculator URL must be an HTTPS origin.');
  return url.origin;
}
function encode(value: unknown) { return Buffer.from(JSON.stringify(value)); }
function decode<T>(value: Buffer) { return JSON.parse(value.toString('utf8')) as T; }

/**
 * Keeps the Calculator bearer credential on the local Atlas service. The
 * renderer only ever sees connection metadata. The encryption key is a
 * per-installation, owner-only file; desktop hosts may supply
 * ATLAS_CREDENTIAL_KEY to bind this to an OS credential store in a future
 * platform adapter without changing the protocol.
 */
export class CalculatorConnectionService {
  #file: string; #keyFile: string; #key: Buffer; #pending = new Map<string, Pending>();
  constructor(databaseFile: string, private readonly callbackOrigin: string, private readonly request: typeof fetch = fetch) {
    const directory = databaseFile === ':memory:' ? process.cwd() : dirname(databaseFile);
    this.#file = databaseFile === ':memory:' ? join(directory, '.atlas-calculator-connection.test.json') : join(directory, 'calculator-connection.json');
    this.#keyFile = databaseFile === ':memory:' ? join(directory, '.atlas-calculator-connection.test.key') : join(directory, 'credentials.key');
    this.#key = this.loadKey();
  }
  private loadKey() {
    const supplied = process.env.ATLAS_CREDENTIAL_KEY;
    if (supplied) return createHash('sha256').update(supplied).digest();
    if (existsSync(this.#keyFile)) return Buffer.from(readFileSync(this.#keyFile, 'utf8').trim(), 'base64url');
    mkdirSync(dirname(this.#keyFile), { recursive: true, mode: 0o700 });
    const key = randomBytes(32); writeFileSync(this.#keyFile, key.toString('base64url'), { mode: 0o600 }); chmodSync(this.#keyFile, 0o600); return key;
  }
  private read(): Stored | null { try { return decode<Stored>(readFileSync(this.#file)); } catch { return null; } }
  private write(value: Stored) { mkdirSync(dirname(this.#file), { recursive: true, mode: 0o700 }); writeFileSync(this.#file, JSON.stringify(value), { mode: 0o600 }); chmodSync(this.#file, 0o600); }
  private encrypt(token: string, connection: CalculatorConnection) { const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',this.#key,iv), ciphertext=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]),tag=cipher.getAuthTag(); this.write({connection,ciphertext:ciphertext.toString('base64url'),iv:iv.toString('base64url'),tag:tag.toString('base64url')}); }
  private token() { const value=this.read(); if(!value) return null; try { const decipher=createDecipheriv('aes-256-gcm',this.#key,Buffer.from(value.iv,'base64url'));decipher.setAuthTag(Buffer.from(value.tag,'base64url')); return Buffer.concat([decipher.update(Buffer.from(value.ciphertext,'base64url')),decipher.final()]).toString('utf8'); } catch { return null; } }
  status() { const value=this.read(); return value ? { configured:true, connection:value.connection } : { configured:false, connection:null }; }
  bearer() { return this.token(); }
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
    const connection:CalculatorConnection={origin:pending.origin,connectionId:value.record.id,name:value.record.name ?? 'FNGK Atlas',expiresAt:value.record.expiresAt ?? '',capabilities:value.record.capabilities ?? []};this.encrypt(value.token,connection); return this.status();
  }
  disconnect() { try { writeFileSync(this.#file, '', { mode: 0o600 }); } catch {} return { configured:false, connection:null }; }
}

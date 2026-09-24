export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly body: Record<string, unknown> = {}) { super(message); }
}
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const capability=desktopCapability(),profile=selectedProfile();
  const response = await fetch(url, { ...init, headers: { accept: 'application/json', ...(profile?{'x-atlas-profile':profile}:{}), ...(capability?{'x-atlas-capability':capability}:{}), ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers } });
  const text = await response.text(); let value: any = {};
  try { value = text ? JSON.parse(text) : {}; } catch { value = { message: text }; }
  if (!response.ok) {
    const causes=Array.isArray(value.routeCauses)?value.routeCauses:[],first=causes[0],detail=first?.message?` ${first.code?`${first.code}: `:''}${first.message}`:'';
    throw new ApiError(response.status, value.error ?? 'request_failed', `${value.message ?? `Request failed (${response.status}).`}${detail}`, value);
  }
  return value as T;
}
export const websocketUrl = (pathname: string) => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${pathname}`;
export const atlasWebSocket = (pathname: string) => { const capability=desktopCapability(),profile=selectedProfile();const url=new URL(pathname,location.href);if(profile&&!url.searchParams.has('profile'))url.searchParams.set('profile',profile);pathname=url.pathname+url.search; return capability?new WebSocket(websocketUrl(pathname),['atlas-capability',capability]):new WebSocket(websocketUrl(pathname)); };
function selectedProfile():string|undefined{try{return localStorage.getItem('atlas.profile.v1')||undefined}catch{return undefined}}
function desktopCapability():string|undefined{return typeof window==='undefined'?undefined:(window as Window&{__ATLAS_CAPABILITY__?:unknown}).__ATLAS_CAPABILITY__ as string|undefined;}

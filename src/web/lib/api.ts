export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly body: Record<string, unknown> = {}) { super(message); }
}
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers } });
  const text = await response.text(); let value: any = {};
  try { value = text ? JSON.parse(text) : {}; } catch { value = { message: text }; }
  if (!response.ok) throw new ApiError(response.status, value.error ?? 'request_failed', value.message ?? `Request failed (${response.status}).`, value);
  return value as T;
}
export const websocketUrl = (pathname: string) => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${pathname}`;

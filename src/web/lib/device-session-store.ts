import { api } from './api.js';

export type DeviceSessionScope = { profile: string; teamId?: string; projectId?: string; deviceId: string };
export type DeviceSessionSnapshot = { scope: DeviceSessionScope; state: string; leaseCount: number; activeStreams: number; sessionId?: string; handshakeCount: number; cacheEpoch: number; connectedAt?: string; lastFailure?: { message: string } };

export class DeviceSessionStore {
  items: DeviceSessionSnapshot[] = [];
  loading = false;
  error = '';
  async refresh(profile?: string) {
    this.loading = true; this.error = '';
    try { this.items = (await api<{ items: DeviceSessionSnapshot[] }>(`/api/device-sessions${profile ? `?${new URLSearchParams({ profile })}` : ''}`)).items; }
    catch (error) { this.error = (error as Error).message; }
    finally { this.loading = false; }
  }
  async act(action: 'reconnect' | 'revoke' | 'cache/clear', scope: DeviceSessionScope) {
    await api(`/api/device-sessions/${action}`, { method: 'POST', body: JSON.stringify(scope) });
    await this.refresh(scope.profile);
  }
}

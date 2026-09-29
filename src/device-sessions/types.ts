import type { TerminalSession } from '../fngk/terminal-session.js';

/** The complete authorization context for one persistent device connection. */
export interface DeviceScope {
  profile: string;
  teamId?: string;
  projectId?: string;
  deviceId: string;
}

export type DeviceSessionState = 'connecting' | 'ready' | 'reconnecting' | 'failed' | 'offline' | 'revoked' | 'closed';

export interface DeviceSessionStateEvent {
  type: 'state' | 'cache_cleared';
  scope: Readonly<DeviceScope>;
  state: DeviceSessionState;
  reason?: string;
  occurredAt: string;
}

export interface DeviceSessionSnapshot {
  scope: Readonly<DeviceScope>;
  state: DeviceSessionState;
  leaseCount: number;
  activeStreams: number;
  sessionId?: string;
  handshakeCount: number;
  cacheEpoch: number;
  connectedAt?: string;
  lastFailure?: { code: string; message: string; occurredAt: string };
}

/** A server-side operation is run once against the active scoped terminal. */
export type DeviceSessionOperation<T> = (context: { session: TerminalSession; signal: AbortSignal }) => Promise<T>;

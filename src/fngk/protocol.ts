export const NAMESPACE_PROTOCOL = 'fngk.namespace.v1' as const;
export const TERMINAL_PROTOCOL = 'fngk.terminal.v1' as const;
export const FILES_PROTOCOL = 'fngk.files.v1' as const;
export const SESSION_PROTOCOL = 'fngk.session.v1' as const;

export interface NativeFileBinding { id:string; name:string; resourceId:string; deviceId:string; deviceName:string; adapterId:string; root:string; readOnly:boolean; capabilities:string[]; provenance:string }
export interface NativeFileBindings { protocolVersion:typeof FILES_PROTOCOL; profile:{name:string}; bindings:NativeFileBinding[] }

export interface NamespaceDevice {
  id: string;
  name: string;
  online?: boolean;
  [key: string]: unknown;
}

export interface NamespaceConnection {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface NamespaceSession {
  id: string;
  title?: string;
  status?: string;
  deviceId?: string;
  deviceName?: string;
  archivedAt?: string;
  expiresAt?: string;
  [key: string]: unknown;
}

export interface NamespaceResource {
  id:string;name:string;kind:string;status?:string;availability?:string;provenance?:string;deviceId:string;projectId?:string;capabilities?:string[];attributes?:Record<string,unknown>;lastObservedAt?:string;
}

export interface NamespaceSnapshot {
  protocolVersion: typeof NAMESPACE_PROTOCOL;
  generatedAt: string;
  profile: { name: string; [key: string]: unknown };
  devices: NamespaceDevice[];
  connections: NamespaceConnection[];
  sessions: NamespaceSession[];
  resources?: NamespaceResource[];
  [key: string]: unknown;
}

export interface TerminalEvent {
  type: string;
  protocolVersion: typeof TERMINAL_PROTOCOL;
  requestId?: string;
  [key: string]: unknown;
}

export type TerminalInput =
  | { type: 'input'; requestId?: string; bodyBase64: string }
  | { type: 'command'; requestId?: string; command: string }
  | { type: 'resize'; requestId?: string; cols: number; rows: number }
  | { type: 'interrupt'; requestId?: string }
  | { type: 'mode'; requestId?: string; mode: 'exclusive' | 'queue' | 'shared' }
  | { type: 'control_request'; requestId?: string }
  | { type: 'control_resolve'; requestId?: string; controlRequestId: string; decision: 'approve' | 'deny' }
  | { type: 'nested_approval_resolve'; requestId?: string; approvalId: string; decision: 'approve' | 'deny' }
  | { type: 'detach'; requestId?: string }
  | { type: 'stop'; requestId?: string };

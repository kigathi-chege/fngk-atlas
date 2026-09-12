export type Operation = 'list' | 'stat' | 'read' | 'write' | 'execute' | 'processes' | 'containers';
export type RouteKind = 'direct' | 'adapter' | 'terminal';

export interface AccessTarget { contextId: string; path?: string; resourceId?: string }

export interface AccessRoute {
  id: string;
  kind: RouteKind;
  contextId: string;
  deviceId?: string;
  effectiveIdentity: string;
  privilege: 'user' | 'elevated' | 'root' | 'unknown';
  observedAt: string;
  available: boolean;
  operations: Operation[];
  covers?: (target: AccessTarget, operation: Operation) => boolean;
}

const priority: Record<RouteKind, number> = { direct: 0, adapter: 1, terminal: 2 };

export class OperationResolver {
  #routes: AccessRoute[];
  constructor(routes: AccessRoute[]) { this.#routes = [...routes]; }
  routes(): readonly AccessRoute[] { return this.#routes; }
  replace(routes: AccessRoute[]): void { this.#routes = [...routes]; }
  resolve(target: AccessTarget, operation: Operation): AccessRoute[] {
    return this.#routes
      .filter(route => route.contextId === target.contextId && route.available && route.operations.includes(operation) && (route.covers?.(target, operation) ?? true))
      .sort((left, right) => priority[left.kind] - priority[right.kind] || left.id.localeCompare(right.id));
  }
}

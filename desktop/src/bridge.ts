import { parseDesktopOperation, type DesktopOperation } from "../contracts.js";

export type DesktopInvoke = <T>(command: DesktopOperation, args: Record<string, never> | { scope: "user" | "system" } | { profile: string } | { operationId: string }) => Promise<T>;

export interface DesktopBridge {
  getLocalStatus(): Promise<unknown>;
  installFngk(input: { scope: "user" | "system" }): Promise<unknown>;
  convergeDaemon(input: { profile: string }): Promise<unknown>;
  cancelOperation(input: { operationId: string }): Promise<unknown>;
  shutdown(): Promise<unknown>;
}

const profilePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const operationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function createDesktopBridge(invoke: DesktopInvoke): DesktopBridge {
  return Object.freeze({
    getLocalStatus: () => invokeOperation(invoke, "atlas_get_local_status", {}),
    installFngk: (input: { scope: "user" | "system" }) => {
      return validated(() => {
        assertExactKeys(input, ["scope"]);
        if (input.scope !== "user" && input.scope !== "system") throw new Error("Install scope is invalid.");
        return invokeOperation(invoke, "atlas_install_fngk", input);
      });
    },
    convergeDaemon: (input: { profile: string }) => invokeProfileOperation(invoke, "atlas_converge_daemon", input),
    cancelOperation: (input: { operationId: string }) => {
      return validated(() => {
        assertExactKeys(input, ["operationId"]);
        if (!operationIdPattern.test(input.operationId)) throw new Error("Operation ID is invalid.");
        return invokeOperation(invoke, "atlas_cancel_operation", input);
      });
    },
    shutdown: () => invokeOperation(invoke, "atlas_shutdown", {}),
  });
}

function invokeProfileOperation(invoke: DesktopInvoke, operation: "atlas_converge_daemon", input: { profile: string }): Promise<unknown> {
  return validated(() => {
    assertExactKeys(input, ["profile"]);
    if (!profilePattern.test(input.profile)) throw new Error("FNGK profile is invalid.");
    return invokeOperation(invoke, operation, input);
  });
}

function invokeOperation(invoke: DesktopInvoke, operation: DesktopOperation, args: Record<string, never> | { scope: "user" | "system" } | { profile: string } | { operationId: string }): Promise<unknown> {
  return invoke(parseDesktopOperation(operation), args);
}

function assertExactKeys(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Desktop operation has an unexpected field.");
}

function validated<T>(operation: () => Promise<T>): Promise<T> {
  return Promise.resolve().then(operation);
}

import {
  BOOTSTRAP_PROTOCOL_VERSION,
  isBootstrapState,
  isRecordWithOnly,
  isSafeBootstrapMessage,
  type BootstrapState,
} from "../src/onboarding/types.js";

export const desktopOperations = [
  "atlas_get_local_status",
  "atlas_install_fngk",
  "atlas_converge_daemon",
  "atlas_cancel_operation",
  "atlas_shutdown",
] as const;

export type DesktopOperation = (typeof desktopOperations)[number];

export interface BootstrapEnvelope {
  protocolVersion: typeof BOOTSTRAP_PROTOCOL_VERSION;
  state: BootstrapState;
  message: string;
  errorCode?: string;
}

export function parseDesktopOperation(value: unknown): DesktopOperation {
  if (typeof value !== "string" || !desktopOperations.includes(value as DesktopOperation)) {
    throw new Error("Unknown desktop operation.");
  }
  return value as DesktopOperation;
}

export function parseBootstrapEnvelope(value: unknown): BootstrapEnvelope {
  if (!isRecordWithOnly(value, ["protocolVersion", "state", "message", "errorCode"])) throw new Error("Bootstrap envelope has an unexpected field.");
  if (value.protocolVersion !== BOOTSTRAP_PROTOCOL_VERSION || !isBootstrapState(value.state) || !isSafeBootstrapMessage(value.message) || (value.errorCode !== undefined && (typeof value.errorCode !== "string" || value.errorCode.length > 96))) {
    throw new Error("Bootstrap envelope is invalid.");
  }
  return { protocolVersion: value.protocolVersion, state: value.state, message: value.message, ...(value.errorCode === undefined ? {} : { errorCode: value.errorCode }) };
}

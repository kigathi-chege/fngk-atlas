import { describe, expect, it } from "vitest";
import { BootstrapService } from "../../src/onboarding/service.js";
import type { FngkContextState } from "../../src/fngk/process-client.js";

const state = (value: Partial<FngkContextState> = {}): FngkContextState => ({
  binary: "/usr/bin/fngk", installed: true, compatible: true, daemon: "reachable", login: "authenticated", profile: "local", namespaceProtocol: "fngk.namespace.v1", terminalProtocol: "fngk.terminal.v1", ...value,
});

describe("desktop FNGK onboarding", () => {
  it.each([
    [state({ installed: false, compatible: false, reason: "binary_missing" }), "install-choice"],
    [state({ compatible: false, reason: "unsupported_protocol" }), "update-choice"],
    [state({ compatible: false, daemon: "unknown", reason: "daemon_unavailable" }), "daemon-install-choice"],
    [state({ compatible: false, profile: undefined, reason: "profile_missing" }), "login-choice"],
    [state({ compatible: false, login: "required", reason: "authentication_required" }), "login-choice"],
    [state(), "ready"],
  ] as const)("maps %s to %s", async (runtime, expected) => {
    const service = new BootstrapService({ probe: async () => runtime, install: async () => {} });
    await expect(service.check()).resolves.toMatchObject({ state: expected });
  });

  it("converges a daemon through FNGK install and reaches ready", async () => {
    let probes = 0, installedProfile = "";
    const service = new BootstrapService({
      probe: async () => (++probes < 2 ? state({ compatible: false, daemon: "unknown", reason: "daemon_unavailable" }) : state()),
      install: async profile => { installedProfile = profile; },
      delay: async () => {},
    });
    const progress = []; for await (const event of service.converge("local")) progress.push(event);
    expect(installedProfile).toBe("local");
    expect(progress.at(-1)).toMatchObject({ phase: "complete", state: "ready" });
  });

  it("reports a bounded timeout and observes cancellation without leaking stderr", async () => {
    const service = new BootstrapService({ probe: async () => state({ compatible: false, daemon: "unknown", reason: "daemon_unavailable" }), install: async () => {}, delay: async () => {} }, { timeoutMs: 0 });
    await expect(async () => { for await (const _event of service.converge("local")) { /* exhaust */ } }).rejects.toMatchObject({ code: "bootstrap_timeout" });
    const controller = new AbortController(); controller.abort();
    await expect(async () => { for await (const _event of service.converge("local", controller.signal)) { /* exhaust */ } }).rejects.toMatchObject({ code: "cancelled" });
  });
});

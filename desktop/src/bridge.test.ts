import { describe, expect, it, vi } from "vitest";
import { createDesktopBridge } from "./bridge.js";

describe("restricted desktop bridge", () => {
  it("exposes only a typed local-status operation to the renderer", async () => {
    const invoke = vi.fn().mockResolvedValue({ state: "ready" });
    const bridge = createDesktopBridge(invoke);

    await expect(bridge.getLocalStatus()).resolves.toEqual({ state: "ready" });
    expect(invoke).toHaveBeenCalledWith("atlas_get_local_status", {});
    expect(Object.keys(bridge).sort()).toEqual([
      "beginLogin",
      "cancelOperation",
      "convergeDaemon",
      "getLocalStatus",
      "installFngk",
      "shutdown",
    ]);
  });

  it("rejects arbitrary commands and hostile operation arguments", async () => {
    const bridge = createDesktopBridge(vi.fn());

    await expect(
      bridge.installFngk({ scope: "user", executable: "/bin/sh" } as never),
    ).rejects.toThrow("unexpected field");
    await expect(
      bridge.convergeDaemon({ profile: "../../other-profile" }),
    ).rejects.toThrow("profile");
    expect((bridge as unknown as { invoke?: unknown }).invoke).toBeUndefined();
  });
});

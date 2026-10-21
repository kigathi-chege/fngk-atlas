import { describe, expect, it } from "vitest";
import { startDesktopEvents, type DeepLinkDetail } from "../../src/web/lib/desktop-events.js";

describe("desktop deep-link events", () => {
  it("dispatches each new deep link once and advances its cursor", async () => {
    const target = new EventTarget(), seen: string[] = [], requested: string[] = [];
    target.addEventListener("atlas:deep-link", event => seen.push((event as CustomEvent<DeepLinkDetail>).detail.url));
    const batches = [[{ seq: 1, url: "fngk-atlas://auth/complete?a", receivedAt: "t" }], [{ seq: 2, url: "fngk-atlas://auth/complete?b", receivedAt: "t" }], []];
    const stop = startDesktopEvents({ target, intervalMs: 1, fetchJson: async <T,>(url: string) => { requested.push(url); return { items: batches.shift() ?? [] } as T; } });
    await new Promise(resolve => setTimeout(resolve, 30));
    stop();
    expect(seen).toEqual(["fngk-atlas://auth/complete?a", "fngk-atlas://auth/complete?b"]);
    expect(requested.slice(0, 3)).toEqual(["/api/desktop/deep-links?after=0", "/api/desktop/deep-links?after=1", "/api/desktop/deep-links?after=2"]);
  });
});

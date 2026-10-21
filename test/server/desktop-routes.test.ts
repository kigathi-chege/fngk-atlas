import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { FngkProcessClient } from "../../src/fngk/process-client.js";
import { FngkProvisioner } from "../../src/onboarding/provisioner.js";
import { isDeepLink } from "../../src/server/desktop-routes.js";

const fixture = path.resolve("test/fixtures/fngk.mjs");
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });
const capability = "desktop-capability-for-route-test";
const headers = { "x-atlas-capability": capability };

async function desktopApp() {
  const directory = await mkdtemp(path.join(tmpdir(), "atlas-desktop-routes-"));
  const desktop = { desktop: true, atlasVersion: "0.4.0", bundledVersion: "v0.2.0", installPath: path.join(directory, "bin/fngk"), provision: "installed", manifestUrl: "https://downloads.example.test/fngk/latest.json" };
  const app = await createApp({ fngk: new FngkProcessClient({ binary: fixture }), dbPath: path.join(directory, "atlas.db"), capability, desktop, fngkProvisioner: new FngkProvisioner(desktop, { publicKeys: [] }) });
  cleanups.push(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return app;
}

describe("desktop routes", () => {
  it("accepts only bounded fngk-atlas deep links", () => {
    expect(isDeepLink("fngk-atlas://auth/complete?state=1")).toBe(true);
    expect(isDeepLink("https://example.test")).toBe(false);
    expect(isDeepLink("fngk-atlas://a\nb")).toBe(false);
    expect(isDeepLink(`fngk-atlas://${"a".repeat(2050)}`)).toBe(false);
  });

  it("records deep links from the host and hands them to the page in order", async () => {
    const app = await desktopApp();
    expect((await app.inject({ method: "POST", url: "/api/desktop/deep-link", payload: { url: "fngk-atlas://auth/complete" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/desktop/deep-link", headers, payload: { url: "javascript:alert(1)" } })).statusCode).toBe(400);
    for (const url of ["fngk-atlas://auth/complete?state=a", "fngk-atlas://auth/complete?state=b"]) expect((await app.inject({ method: "POST", url: "/api/desktop/deep-link", headers, payload: { url } })).statusCode).toBe(202);
    const all = (await app.inject({ method: "GET", url: "/api/desktop/deep-links?after=0", headers })).json();
    expect(all.items.map((item: { url: string }) => item.url)).toEqual(["fngk-atlas://auth/complete?state=a", "fngk-atlas://auth/complete?state=b"]);
    expect((await app.inject({ method: "GET", url: `/api/desktop/deep-links?after=${all.items[0].seq}`, headers })).json().items).toHaveLength(1);
  });

  it("reports versions and the host's update state", async () => {
    const app = await desktopApp();
    expect((await app.inject({ method: "POST", url: "/api/desktop/update-state", headers, payload: { status: "bogus" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/desktop/update-state", headers, payload: { status: "available", version: "0.5.0", currentVersion: "0.4.0" } })).statusCode).toBe(204);
    const info = (await app.inject({ method: "GET", url: "/api/desktop/info", headers })).json();
    expect(info).toMatchObject({ desktop: true, atlasVersion: "0.4.0", fngk: { bundledVersion: "v0.2.0", provision: "installed" }, update: { status: "available", version: "0.5.0" } });
  });

  it("requires confirmation to install or update FNGK and fails closed without a pinned key", async () => {
    const app = await desktopApp();
    expect((await app.inject({ method: "POST", url: "/api/onboarding/install", headers, payload: { scope: "user" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/api/fngk/signed-update", headers, payload: {} })).statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: "/api/fngk/signed-update", headers })).json()).toMatchObject({ available: false, errorCode: "manifest_key_unpinned" });
    const install = await app.inject({ method: "POST", url: "/api/onboarding/install", headers, payload: { scope: "user", confirm: true } });
    expect(install.statusCode).toBeGreaterThanOrEqual(400);
    expect(install.json().error).toBe("manifest_key_unpinned");
  });
});

import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFngkLoginLauncher, SignInService, type LoginLauncher, type LoginProcess } from "../../src/onboarding/signin.js";
import { DEFAULT_SIGNAL_URL, defaultSignalUrl, normalizeSignalUrl } from "../../src/onboarding/signal-url.js";

const start = (overrides: Record<string, unknown> = {}) => ({ protocolVersion: "fngk.login.v1", state: "authorization-required", authorizationUrl: "https://signal.nipate.africa/cli-authorize?code=A1B2C3D4E5F6", stateId: "device-code-0123456789", expiresAt: "2030-01-01T00:00:00Z", profile: "local", userCode: "A1B2C3D4E5F6", signalUrl: "https://signal.nipate.africa", pairing: true, ...overrides });

/** A scripted fngk: emits the given events, then exits with the given stderr (or success). */
function scripted(events: unknown[], options: { stderr?: string; hold?: boolean } = {}) {
  const calls: string[][] = [];
  let cancelled = 0;
  const launcher: LoginLauncher = { start(args) {
    calls.push(args);
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    let failure: Error | undefined;
    const done = (async () => { if (options.hold) await held; if (options.stderr !== undefined) { failure = Object.assign(new Error("FNGK login did not complete."), { code: "login_process_failed", stderr: options.stderr }); throw failure; } })();
    done.catch(() => {});
    const iterator = (async function* () { for (const event of events) yield event; if (options.hold) await held; await done; })();
    const process: LoginProcess = { events: { [Symbol.asyncIterator]: () => iterator }, done, cancel: () => { cancelled++; release(); } };
    return process;
  } };
  return { launcher, calls, cancelled: () => cancelled };
}

const settle = async (service: SignInService, id: string) => { for (let index = 0; index < 300; index++) { const view = service.get(id)!; if (!["waiting", "authenticated"].includes(view.state)) return view; await new Promise(resolve => setTimeout(resolve, 10)); } return service.get(id)!; };

describe("Signal URL", () => {
  it("has one built-in default that FNGK_SIGNAL_URL overrides", () => {
    expect(DEFAULT_SIGNAL_URL).toBe("https://signal.nipate.africa");
    expect(defaultSignalUrl({})).toBe("https://signal.nipate.africa");
    expect(defaultSignalUrl({ FNGK_SIGNAL_URL: "http://signal.localhost/" })).toBe("http://signal.localhost");
    expect(defaultSignalUrl({ FNGK_SIGNAL_URL: "ftp://bad" })).toBe("https://signal.nipate.africa");
  });
  it("accepts https and only local http", () => {
    expect(normalizeSignalUrl("https://signal.example.com/path")).toBe("https://signal.example.com");
    expect(normalizeSignalUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
    for (const value of ["http://signal.example.com", "javascript:alert(1)", "https://user:pass@x.example", "", 7]) expect(normalizeSignalUrl(value)).toBeNull();
  });
});

describe("SignInService", () => {
  it("runs fngk login --pair against the default Signal and completes once the Device is paired", async () => {
    const fngk = scripted([start(), { protocolVersion: "fngk.login.v1", state: "authenticated", profile: "local", account: "dev@signal.localhost" }, { protocolVersion: "fngk.login.v1", state: "paired", profile: "local", deviceId: "d1", deviceName: "host" }]);
    const service = new SignInService(fngk.launcher, { now: () => Date.parse("2026-10-21T00:00:00Z") });
    const view = await service.begin({ profile: "local", returnTo: "fngk-atlas://auth/complete" });
    expect(fngk.calls[0]).toEqual(["login", "--profile", "local", "--pair", "--json", "--client", "FNGK Atlas", "--return-to", "fngk-atlas://auth/complete"]);
    expect(view).toMatchObject({ state: "waiting", signalUrl: "https://signal.nipate.africa", userCode: "A1B2C3D4E5F6", pairing: true });
    expect(await settle(service, view.id)).toMatchObject({ state: "complete", account: "dev@signal.localhost", device: { state: "paired", name: "host" } });
  });
  it("passes a self-hosted Signal and Device name explicitly and requires the link to match it", async () => {
    const fngk = scripted([start({ signalUrl: "https://self.example.com", authorizationUrl: "https://self.example.com/cli-authorize?code=X" })]);
    const service = new SignInService(fngk.launcher, { now: () => 0 });
    await service.begin({ profile: "work", signalUrl: "https://self.example.com/", deviceName: "build box" }).catch(() => {});
    expect(fngk.calls[0].slice(0, 3)).toEqual(["login", "https://self.example.com", "--profile"]);
    expect(fngk.calls[0]).toEqual(expect.arrayContaining(["--device-name", "build box"]));
    const mismatch = scripted([start({ authorizationUrl: "https://evil.example/cli-authorize?code=X" })]);
    await expect(new SignInService(mismatch.launcher, { now: () => 0 }).begin({ profile: "local" })).rejects.toMatchObject({ code: "authorization_origin_invalid" });
    expect(mismatch.cancelled()).toBe(1);
    const wrongSignal = scripted([start({ signalUrl: "https://other.example.com", authorizationUrl: "https://other.example.com/x" })]);
    await expect(new SignInService(wrongSignal.launcher, { now: () => 0 }).begin({ profile: "local", signalUrl: "https://self.example.com" })).rejects.toMatchObject({ code: "login_protocol_invalid" });
  });
  it("rejects invalid input before starting fngk", async () => {
    const fngk = scripted([]);
    const service = new SignInService(fngk.launcher);
    await expect(service.begin({ profile: "../bad" })).rejects.toMatchObject({ code: "profile_invalid" });
    await expect(service.begin({ profile: "local", signalUrl: "http://plain.example.com" })).rejects.toMatchObject({ code: "signal_url_invalid" });
    await expect(service.begin({ profile: "local", deviceName: "two\nlines" })).rejects.toMatchObject({ code: "device_name_invalid" });
    expect(fngk.calls).toHaveLength(0);
  });
  it("reports an older Signal that cannot pair, and a denied or failed pairing", async () => {
    const old = scripted([start({ pairing: false }), { protocolVersion: "fngk.login.v1", state: "authenticated", profile: "local" }, { protocolVersion: "fngk.login.v1", state: "pairing-unavailable", profile: "local", reason: "signal_pairing_unsupported" }]);
    const oldService = new SignInService(old.launcher, { now: () => 0 });
    const oldView = await oldService.begin({ profile: "local" });
    expect(oldView.pairing).toBe(false);
    expect(await settle(oldService, oldView.id)).toMatchObject({ state: "complete", device: { state: "unavailable" } });
    const denied = scripted([start()], { stderr: 'fngk: authorization failed (403): {"error":"authorization_denied"}' });
    const deniedService = new SignInService(denied.launcher, { now: () => 0 });
    const deniedView = await deniedService.begin({ profile: "local" });
    expect(await settle(deniedService, deniedView.id)).toMatchObject({ state: "failed", error: { code: "authorization_denied" } });
    const pairing = scripted([start(), { protocolVersion: "fngk.login.v1", state: "authenticated", profile: "local" }], { stderr: "fngk: pairing failed (400): invalid_or_expired_pairing_code" });
    const pairingService = new SignInService(pairing.launcher, { now: () => 0 });
    const pairingView = await pairingService.begin({ profile: "local" });
    expect(await settle(pairingService, pairingView.id)).toMatchObject({ state: "failed", error: { code: "pairing_failed" } });
  });
  it("cancels, expires, and replaces a waiting sign-in", async () => {
    let now = Date.parse("2029-12-31T23:59:00Z");
    const fngk = scripted([start()], { hold: true });
    const service = new SignInService(fngk.launcher, { now: () => now });
    const first = await service.begin({ profile: "local" });
    const second = await service.begin({ profile: "local" });
    expect(fngk.cancelled()).toBe(1);
    expect(service.get(first.id)).toBeUndefined();
    now = Date.parse("2030-01-01T00:00:01Z");
    expect(service.get(second.id)).toMatchObject({ state: "failed", error: { code: "authorization_expired" } });
    expect(await service.cancel(second.id)).toBe(true);
    expect(await service.cancel(second.id)).toBe(false);
  });
  it("recognises an FNGK too old for login --pair", async () => {
    const fngk = scripted([], { stderr: "fngk: invalid Signal URL: expected an absolute http(s) Signal URL" });
    await expect(new SignInService(fngk.launcher).begin({ profile: "local" })).rejects.toMatchObject({ code: "fngk_update_required" });
  });
  it("drives a real child process through the fake fngk", async () => {
    const launcher = createFngkLoginLauncher(path.resolve("test/fixtures/fngk.mjs"), { ...process.env, FNGK_FIXTURE_MODE: "ok", FNGK_SIGNAL_URL: "http://signal.localhost" });
    const service = new SignInService(launcher);
    const view = await service.begin({ profile: "local" });
    expect(view).toMatchObject({ signalUrl: "http://signal.localhost", authorizationUrl: "http://signal.localhost/cli-authorize?code=A1B2C3D4E5F6" });
    expect(await settle(service, view.id)).toMatchObject({ state: "complete", device: { state: "paired" } });
  });
});

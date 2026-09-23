import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FngkBrowserAuthorizationRuntime, createLocalFngkLoginLauncher } from "../../src/onboarding/fngk-auth.js";

const directories: string[] = [];
afterEach(async () => { while (directories.length) await rm(directories.pop()!, { recursive: true, force: true }); });

const events = async function* () {
  yield { protocolVersion: "fngk.login.v1", state: "authorization-required", authorizationUrl: "https://signal.example.test/authorize", stateId: "state-123", expiresAt: "2026-09-22T18:00:00.000Z", profile: "local" };
  yield { protocolVersion: "fngk.login.v1", state: "authenticated", profile: "local" };
};

describe("FNGK JSON login adapter", () => {
  it("starts the structured FNGK login flow and returns no credential to Atlas", async () => {
    const commands: string[][] = [];
    const runtime = new FngkBrowserAuthorizationRuntime({ start: args => { commands.push(args); return { events: events(), done: Promise.resolve(), cancel: () => {} }; } }, "fngk", "https://signal.example.test");
    await expect(runtime.begin("local")).resolves.toMatchObject({ stateId: "state-123", authorizationUrl: "https://signal.example.test/authorize" });
    await expect(runtime.complete({ stateId: "state-123" })).resolves.toEqual({ profile: "local", authenticated: true });
    expect(commands).toEqual([["login", "https://signal.example.test", "--profile", "local", "--json"]]);
  });

  it("rejects an event that attempts to carry a credential", async () => {
    const runtime = new FngkBrowserAuthorizationRuntime({ start: () => ({ events: (async function* () { yield { protocolVersion: "fngk.login.v1", state: "authorization-required", authorizationUrl: "https://signal.example.test/authorize", stateId: "state-123", expiresAt: "2026-09-22T18:00:00.000Z", credential: "secret" }; })(), done: Promise.resolve(), cancel: () => {} }) }, "fngk", "https://signal.example.test");
    await expect(runtime.begin("local")).rejects.toMatchObject({ code: "login_protocol_invalid" });
  });

  it("consumes FNGK JSONL over a fixed executable boundary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "atlas-fngk-login-")); directories.push(root); const binary = path.join(root, "fngk");
    await writeFile(binary, `#!/usr/bin/env node\nconsole.log(JSON.stringify({protocolVersion:'fngk.login.v1',state:'authorization-required',authorizationUrl:'https://signal.example.test/authorize',stateId:'state-456',expiresAt:'2026-09-22T18:00:00.000Z',profile:'local'}));console.log(JSON.stringify({protocolVersion:'fngk.login.v1',state:'authenticated',profile:'local'}));\n`); await chmod(binary, 0o755);
    const runtime = new FngkBrowserAuthorizationRuntime(createLocalFngkLoginLauncher(binary), binary, "https://signal.example.test");
    await expect(runtime.begin("local")).resolves.toMatchObject({ stateId: "state-456" });
    await expect(runtime.complete({ stateId: "state-456" })).resolves.toEqual({ profile: "local", authenticated: true });
  });
});

import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { manifestSigningPayload } from "../../src/onboarding/artifacts.js";
import { createSignatureVerifier, ed25519PublicKey, manifestPublicKeys, PINNED_FNGK_MANIFEST_KEYS } from "../../src/onboarding/manifest-trust.js";
import { desktopEnvironment, FngkProvisioner } from "../../src/onboarding/provisioner.js";
import { BOOTSTRAP_PROTOCOL_VERSION, type InstallManifest } from "../../src/onboarding/types.js";
import { compareVersions, parseVersionOutput } from "../../src/onboarding/version.js";

const execFileAsync = promisify(execFile);
const directories: string[] = [];
afterEach(async () => { while (directories.length) await rm(directories.pop()!, { recursive: true, force: true }); });
const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const noop = () => {};

async function scratch() { const root = await mkdtemp(path.join(tmpdir(), "atlas-provisioner-")); directories.push(root); return root; }
async function fakeFngk(file: string, version: string, exitCode = 0) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `#!/bin/sh\necho "fngk ${version}"\nexit ${exitCode}\n`); await chmod(file, 0o755);
}
async function archive(root: string, version: string, exitCode = 0): Promise<Buffer> {
  const staging = path.join(root, `archive-${version}-${exitCode}`); await fakeFngk(path.join(staging, "fngk"), version, exitCode);
  await writeFile(path.join(staging, "signal"), "compat"); const out = path.join(root, `fngk-${version}-${exitCode}.tar.gz`);
  await execFileAsync("tar", ["-czf", out, "-C", staging, "fngk", "signal"]); return readFile(out);
}
function keys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(), publicRaw: Buffer.from(publicKey.export({ format: "jwk" }).x!, "base64url").toString("base64") };
}
function signedManifest(body: Buffer, version: string, privateKey: ReturnType<typeof keys>["privateKey"]): InstallManifest {
  const manifest: InstallManifest = { protocolVersion: BOOTSTRAP_PROTOCOL_VERSION, version, artifacts: [{ platform: "linux", architecture: "x64", url: `https://downloads.example.test/fngk/${version}/fngk_linux_amd64.tar.gz`, sha256: sha(body), bytes: body.length, signature: "" }] };
  manifest.artifacts[0].signature = sign(null, manifestSigningPayload(manifest, manifest.artifacts[0]), privateKey).toString("base64");
  return manifest;
}
function fetcher(files: Record<string, Buffer | string>): typeof fetch {
  return (async (input: string | URL) => {
    const body = files[String(input)];
    return body === undefined ? new Response("missing", { status: 404 }) : new Response(typeof body === "string" ? body : new Uint8Array(body), { status: 200 });
  }) as typeof fetch;
}
const manifestUrl = "https://downloads.example.test/fngk/latest.json";

describe("FNGK manifest trust", () => {
  it("pins the production key and accepts PEM and raw dev keys", async () => {
    expect(PINNED_FNGK_MANIFEST_KEYS).toHaveLength(1);
    expect(ed25519PublicKey(PINNED_FNGK_MANIFEST_KEYS[0]).asymmetricKeyType).toBe("ed25519");
    expect(manifestPublicKeys({})).toEqual([...PINNED_FNGK_MANIFEST_KEYS]);
    expect(manifestPublicKeys({ ATLAS_FNGK_MANIFEST_PUBLIC_KEY: "a;b" })).toEqual(["a", "b"]);
    expect(manifestPublicKeys({ ATLAS_FNGK_MANIFEST_PUBLIC_KEY: "" })).toEqual([...PINNED_FNGK_MANIFEST_KEYS]);
    const pair = keys(), payload = Buffer.from("payload"), signature = sign(null, payload, pair.privateKey).toString("base64");
    await expect(createSignatureVerifier([pair.publicPem])(payload, signature)).resolves.toBe(true);
    await expect(createSignatureVerifier([pair.publicRaw])(payload, signature)).resolves.toBe(true);
    await expect(createSignatureVerifier(PINNED_FNGK_MANIFEST_KEYS)(payload, signature)).resolves.toBe(false);
    await expect(createSignatureVerifier([pair.publicPem])(Buffer.from("tampered"), signature)).resolves.toBe(false);
    expect(() => ed25519PublicKey("AAAA")).toThrow(/Ed25519/);
  });

  it("compares versions like the desktop host", () => {
    expect(compareVersions("v0.2.0", "v0.1.9")).toBe(1);
    expect(compareVersions("v0.2.0-rc.1", "v0.2.0")).toBe(-1);
    expect(compareVersions("v0.1.0-dev", "0.1.0-dev")).toBe(0);
    expect(compareVersions("head", "v1.0.0")).toBeUndefined();
    expect(parseVersionOutput("signal v0.1.0-dev\n")).toBe("v0.1.0-dev");
  });
});

describe("FNGK provisioner", () => {
  it("installs the bundled FNGK when none is installed and records ownership", async () => {
    const root = await scratch(), bundled = path.join(root, "bundle/fngk"), target = path.join(root, "home/.local/bin/fngk"), markerPath = path.join(root, "data/fngk-install.json");
    await fakeFngk(bundled, "v0.2.0");
    const provisioner = new FngkProvisioner({ desktop: true, manifestUrl, bundledPath: bundled, bundledSha256: sha(await readFile(bundled)), bundledVersion: "v0.2.0", installPath: target, markerPath }, { publicKeys: [] });
    const result = await provisioner.installBinary("user", noop);
    expect(result).toMatchObject({ state: "checking", installedPath: target, version: "v0.2.0" });
    expect(await provisioner.currentVersion()).toBe("v0.2.0");
    expect(JSON.parse(await readFile(markerPath, "utf8"))).toMatchObject({ path: target, version: "v0.2.0" });
    await expect(provisioner.installBinary("system", noop)).resolves.toMatchObject({ state: "recoverable-error", errorCode: "elevation_required" });
  });

  it("downloads, verifies and installs a newer signed FNGK, keeping a backup", async () => {
    const root = await scratch(), target = path.join(root, "bin/fngk"), pair = keys(), body = await archive(root, "v0.3.0"), manifest = signedManifest(body, "v0.3.0", pair.privateKey);
    await fakeFngk(target, "v0.2.0");
    const provisioner = new FngkProvisioner({ desktop: true, manifestUrl, installPath: target }, { publicKeys: [pair.publicPem], platform: "linux", architecture: "x64", fetcher: fetcher({ [manifestUrl]: JSON.stringify(manifest), [manifest.artifacts[0].url]: body }) });
    await expect(provisioner.checkForUpdate()).resolves.toMatchObject({ currentVersion: "v0.2.0", latestVersion: "v0.3.0", available: true });
    const events: string[] = [];
    await expect(provisioner.applyUpdate(event => events.push(event.phase))).resolves.toMatchObject({ installedPath: target, version: "v0.3.0" });
    expect(await provisioner.currentVersion()).toBe("v0.3.0");
    expect((await readFile(`${target}.atlas-backup`, "utf8"))).toContain("v0.2.0");
    expect(events).toEqual(expect.arrayContaining(["checking", "downloading", "verifying", "installing", "complete"]));
    await expect(provisioner.checkForUpdate()).resolves.toMatchObject({ available: false });
  });

  it("rejects a manifest signed by an untrusted key and leaves FNGK alone", async () => {
    const root = await scratch(), target = path.join(root, "bin/fngk"), trusted = keys(), attacker = keys(), body = await archive(root, "v9.0.0"), manifest = signedManifest(body, "v9.0.0", attacker.privateKey);
    await fakeFngk(target, "v0.2.0");
    const provisioner = new FngkProvisioner({ desktop: true, manifestUrl, installPath: target }, { publicKeys: [trusted.publicPem], platform: "linux", architecture: "x64", fetcher: fetcher({ [manifestUrl]: JSON.stringify(manifest), [manifest.artifacts[0].url]: body }) });
    await expect(provisioner.checkForUpdate()).resolves.toMatchObject({ available: false, errorCode: "artifact_signature_invalid" });
    await expect(provisioner.applyUpdate(noop)).rejects.toMatchObject({ code: "artifact_signature_invalid" });
    expect(await provisioner.currentVersion()).toBe("v0.2.0");
  });

  it("rejects an archive that does not match the signed checksum", async () => {
    const root = await scratch(), target = path.join(root, "bin/fngk"), pair = keys(), body = await archive(root, "v0.3.0"), manifest = signedManifest(body, "v0.3.0", pair.privateKey);
    await fakeFngk(target, "v0.2.0");
    const swapped = await archive(root, "v0.3.0", 1);
    const provisioner = new FngkProvisioner({ desktop: true, manifestUrl, installPath: target }, { publicKeys: [pair.publicPem], platform: "linux", architecture: "x64", fetcher: fetcher({ [manifestUrl]: JSON.stringify(manifest), [manifest.artifacts[0].url]: swapped }) });
    await expect(provisioner.applyUpdate(noop)).rejects.toMatchObject({ code: expect.stringMatching(/artifact_(size|checksum)_mismatch/) });
    expect(await provisioner.currentVersion()).toBe("v0.2.0");
  });

  it("rolls back a signed update that does not run", async () => {
    const root = await scratch(), target = path.join(root, "bin/fngk"), pair = keys(), body = await archive(root, "v0.3.0", 1), manifest = signedManifest(body, "v0.3.0", pair.privateKey);
    await fakeFngk(target, "v0.2.0");
    const provisioner = new FngkProvisioner({ desktop: true, manifestUrl, installPath: target }, { publicKeys: [pair.publicPem], platform: "linux", architecture: "x64", fetcher: fetcher({ [manifestUrl]: JSON.stringify(manifest), [manifest.artifacts[0].url]: body }) });
    await expect(provisioner.applyUpdate(noop)).resolves.toMatchObject({ state: "recoverable-error", errorCode: "artifact_probe_failed", rolledBack: true });
    expect(await provisioner.currentVersion()).toBe("v0.2.0");
  });

  it("fails closed without a pinned key and reads the desktop host environment", async () => {
    const provisioner = new FngkProvisioner({ desktop: false, manifestUrl, installPath: "/nonexistent/fngk" }, { publicKeys: [] });
    await expect(provisioner.checkForUpdate()).resolves.toMatchObject({ available: false, errorCode: "manifest_key_unpinned" });
    expect(desktopEnvironment({ ATLAS_DESKTOP: "1", ATLAS_VERSION: "0.2.0", ATLAS_FNGK_INSTALL_PATH: "/x/fngk" })).toMatchObject({ desktop: true, atlasVersion: "0.2.0", installPath: "/x/fngk", manifestUrl: "https://downloads.signol.org/fngk/latest.json" });
  });
});

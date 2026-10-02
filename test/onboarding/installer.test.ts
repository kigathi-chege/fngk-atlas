import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  downloadFngkArtifact,
  locateFngk,
  verifyFngkArtifact,
} from "../../src/onboarding/artifacts.js";
import { installFngk } from "../../src/onboarding/installer.js";
import { BOOTSTRAP_PROTOCOL_VERSION, type InstallManifest } from "../../src/onboarding/types.js";

const directories: string[] = [];
afterEach(async () => { while (directories.length) await rm(directories.pop()!, { recursive: true, force: true }); });
const digest = (body: Buffer) => createHash("sha256").update(body).digest("hex");
const execFileAsync = promisify(execFile);
const manifest = (body: Buffer, url = "https://downloads.example.test/fngk_linux_x64.tar.gz"): InstallManifest => ({
  protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
  version: "0.1.0-dev",
  artifacts: [{ platform: "linux", architecture: "x64", url, sha256: digest(body), signature: "signature", bytes: body.length }],
});

describe("FNGK desktop installer", () => {
  it("prefers bundled then configured then PATH candidates and filters incompatible probes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "atlas-fngk-locate-")); directories.push(root);
    const bundled = path.join(root, "bundled"), configured = path.join(root, "configured"), fromPath = path.join(root, "path-fngk");
    await Promise.all([bundled, configured, fromPath].map(async file => { await writeFile(file, "stub"); await chmod(file, 0o755); }));
    const candidates = await locateFngk({ bundledPath: bundled, configuredPath: configured, pathEntries: [fromPath], probe: async candidate => ({ compatible: candidate.path !== configured }) });
    expect(candidates.map(candidate => [candidate.source, candidate.path])).toEqual([["bundled", bundled], ["path", fromPath]]);
  });

  it("rejects unsigned, mismatched, oversized, and wrong-architecture artifacts", async () => {
    const archive = Buffer.from("archive"), signed = manifest(archive);
    await expect(verifyFngkArtifact(signed, archive, "linux", "x64", { verifySignature: async () => false })).rejects.toMatchObject({ code: "artifact_signature_invalid" });
    await expect(verifyFngkArtifact({ ...signed, artifacts: [{ ...signed.artifacts[0], sha256: "0".repeat(64) }] }, archive, "linux", "x64", { verifySignature: async () => true })).rejects.toMatchObject({ code: "artifact_checksum_mismatch" });
    await expect(verifyFngkArtifact(signed, archive, "linux", "arm64", { verifySignature: async () => true })).rejects.toMatchObject({ code: "artifact_architecture_unsupported" });
    await expect(verifyFngkArtifact(signed, archive, "linux", "x64", { maxBytes: 2, verifySignature: async () => true })).rejects.toMatchObject({ code: "artifact_size_exceeded" });
  });

  it("refuses HTTP downloads and unsafe archive entries before replacing an executable", async () => {
    await expect(downloadFngkArtifact("http://downloads.example.test/fngk.tar.gz")).rejects.toMatchObject({ code: "artifact_url_invalid" });
    const archive = Buffer.from("archive"), signed = manifest(archive), verified = await verifyFngkArtifact(signed, archive, "linux", "x64", { verifySignature: async () => true });
    const root = await mkdtemp(path.join(tmpdir(), "atlas-fngk-install-")); directories.push(root);
    await expect(installFngk(verified, "user", () => {}, { userInstallDir: root, extract: async () => [{ path: "../fngk", kind: "file" }] })).rejects.toMatchObject({ code: "artifact_path_escape" });
    await expect(installFngk(verified, "user", () => {}, { userInstallDir: root, extract: async () => [{ path: "fngk", kind: "symlink" }] })).rejects.toMatchObject({ code: "artifact_symlink_rejected" });
  });

  it("atomically backs up a user binary and leaves it intact when replacement fails", async () => {
    const archive = Buffer.from("archive"), verified = await verifyFngkArtifact(manifest(archive), archive, "linux", "x64", { verifySignature: async () => true });
    const root = await mkdtemp(path.join(tmpdir(), "atlas-fngk-atomic-")); directories.push(root);
    const target = path.join(root, "fngk"); await writeFile(target, "old");
    const extract = async (_archive: Buffer, directory: string) => { await writeFile(path.join(directory, "fngk"), "new"); return [{ path: "fngk", kind: "file" as const }]; };
    await expect(installFngk(verified, "user", () => {}, { userInstallDir: root, extract })).resolves.toMatchObject({ installedPath: target, rolledBack: false });
    await expect(readFile(target, "utf8")).resolves.toBe("new");
    await expect(readFile(`${target}.atlas-backup`, "utf8")).resolves.toBe("old");
    await writeFile(target, "old-again");
    await expect(installFngk(verified, "user", () => {}, { userInstallDir: root, extract, replace: async () => { throw new Error("disk failure"); } })).rejects.toMatchObject({ code: "artifact_install_failed" });
    await expect(readFile(target, "utf8")).resolves.toBe("old-again");
  });

  it("installs a disposable tar archive after inspecting its real entries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "atlas-fngk-tar-")); directories.push(root);
    const archivePath = path.join(root, "fngk.tar.gz"), destination = path.join(root, "destination");
    await writeFile(path.join(root, "fngk"), "#!/bin/sh\necho fngk\n"); await chmod(path.join(root, "fngk"), 0o755);
    await execFileAsync("tar", ["-czf", archivePath, "-C", root, "fngk"]);
    const archive = await readFile(archivePath), verified = await verifyFngkArtifact(manifest(archive), archive, "linux", "x64", { verifySignature: async () => true });
    await expect(installFngk(verified, "user", () => {}, { userInstallDir: destination })).resolves.toMatchObject({ installedPath: path.join(destination, "fngk") });
    await expect(readFile(path.join(destination, "fngk"), "utf8")).resolves.toContain("echo fngk");
  });
});

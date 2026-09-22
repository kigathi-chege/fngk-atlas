import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_PROTOCOL_VERSION,
  bootstrapTransition,
  isSafeBootstrapMessage,
  isValidInstallManifest,
  type InstallManifest,
} from "../../src/onboarding/types.js";

describe("desktop bootstrap contracts", () => {
  it("allows only defined onboarding state transitions", () => {
    expect(bootstrapTransition("checking", "install-choice")).toBe(true);
    expect(bootstrapTransition("checking", "ready")).toBe(true);
    expect(bootstrapTransition("ready", "install-choice")).toBe(false);
    expect(bootstrapTransition("recoverable-error", "checking")).toBe(true);
  });

  it("accepts bounded redacted progress messages", () => {
    expect(isSafeBootstrapMessage("Verifying the FNGK package.")).toBe(true);
    expect(isSafeBootstrapMessage("x".repeat(481))).toBe(false);
    expect(isSafeBootstrapMessage("credential=secret-value")).toBe(false);
  });

  it("validates a platform-specific install manifest without credential fields", () => {
    const manifest: InstallManifest = {
      protocolVersion: BOOTSTRAP_PROTOCOL_VERSION,
      version: "0.1.0-dev",
      artifacts: [
        {
          platform: "linux",
          architecture: "x64",
          url: "https://downloads.example.test/fngk-linux-x64.tar.gz",
          sha256: "a".repeat(64),
          signature: "base64-signature",
          bytes: 42,
        },
      ],
    };
    expect(isValidInstallManifest(manifest, "linux", "x64")).toBe(true);
    expect(isValidInstallManifest(manifest, "linux", "arm64")).toBe(false);
    expect(
      isValidInstallManifest(
        { ...manifest, credential: "must-not-be-accepted" } as InstallManifest,
        "linux",
        "x64",
      ),
    ).toBe(false);
  });
});

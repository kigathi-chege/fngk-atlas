import { describe, expect, it } from "vitest";
import {
  parseBootstrapEnvelope,
  parseDesktopOperation,
} from "./contracts.js";

describe("desktop IPC contracts", () => {
  it("accepts a valid redacted bootstrap envelope", () => {
    expect(
      parseBootstrapEnvelope({
        protocolVersion: "atlas.desktop-bootstrap.v1",
        state: "login-choice",
        message: "Sign in to continue.",
      }),
    ).toEqual({
      protocolVersion: "atlas.desktop-bootstrap.v1",
      state: "login-choice",
      message: "Sign in to continue.",
    });
  });

  it("rejects credentials and unknown desktop operations at the renderer boundary", () => {
    expect(() =>
      parseBootstrapEnvelope({
        protocolVersion: "atlas.desktop-bootstrap.v1",
        state: "ready",
        message: "Ready",
        credential: "secret",
      }),
    ).toThrow("unexpected field");
    expect(() => parseDesktopOperation("shell_execute")).toThrow("Unknown desktop operation");
  });
});

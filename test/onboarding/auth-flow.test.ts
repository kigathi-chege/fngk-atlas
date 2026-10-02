import { describe, expect, it } from "vitest";
import { AuthFlow } from "../../src/onboarding/auth-flow.js";

const runtime = () => ({
  begin: async (profile: string) => ({ authorizationUrl: "https://signal.example.test/authorize?code=visible-code", stateId: "state-123", expiresAt: "2026-09-22T18:00:00.000Z", profile }),
  complete: async (input: { stateId: string; code?: string }) => ({ profile: "local" as const, authenticated: true as const, received: input }),
  cancel: async () => {},
});

describe("browser FNGK authorization", () => {
  it("completes a matching one-time callback without returning a credential", async () => {
    const auth = new AuthFlow(runtime(), { origin: "https://signal.example.test", now: () => Date.parse("2026-09-22T17:00:00.000Z") });
    await expect(auth.beginLogin("local")).resolves.toMatchObject({ stateId: "state-123", authorizationUrl: "https://signal.example.test/authorize?code=visible-code" });
    await expect(auth.completeLogin({ stateId: "state-123", origin: "https://signal.example.test", receivedAt: "2026-09-22T17:01:00.000Z", code: "callback-code" })).resolves.toEqual({ profile: "local", authenticated: true });
    await expect(auth.completeLogin({ stateId: "state-123", origin: "https://signal.example.test", receivedAt: "2026-09-22T17:01:00.000Z" })).rejects.toMatchObject({ code: "authorization_replayed" });
  });

  it.each([
    [{ stateId: "wrong", origin: "https://signal.example.test", receivedAt: "2026-09-22T17:01:00.000Z" }, "authorization_state_invalid"],
    [{ stateId: "state-123", origin: "https://evil.example.test", receivedAt: "2026-09-22T17:01:00.000Z" }, "authorization_origin_invalid"],
    [{ stateId: "state-123", origin: "https://signal.example.test", receivedAt: "not-a-date" }, "authorization_callback_invalid"],
  ] as const)("rejects invalid callback %o", async (callback, code) => {
    const auth = new AuthFlow(runtime(), { origin: "https://signal.example.test", now: () => Date.parse("2026-09-22T17:00:00.000Z") }); await auth.beginLogin("local");
    await expect(auth.completeLogin(callback)).rejects.toMatchObject({ code });
  });

  it("expires a pending authorization and cancels one before it is consumed", async () => {
    let cancelled = "";
    const client = runtime(); client.cancel = async stateId => { cancelled = stateId; };
    let now = Date.parse("2026-09-22T17:00:00.000Z"); const auth = new AuthFlow(client, { origin: "https://signal.example.test", now: () => now }); await auth.beginLogin("local"); now = Date.parse("2026-09-22T19:00:00.000Z");
    await expect(auth.completeLogin({ stateId: "state-123", origin: "https://signal.example.test", receivedAt: "2026-09-22T19:00:00.000Z" })).rejects.toMatchObject({ code: "authorization_expired" });
    now = Date.parse("2026-09-22T17:00:00.000Z"); await auth.beginLogin("local"); await auth.cancelLogin("state-123"); expect(cancelled).toBe("state-123");
  });
});

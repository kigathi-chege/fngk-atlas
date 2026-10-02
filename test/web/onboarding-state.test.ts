import { describe, expect, it } from "vitest";
import { resolveOnboardingPresentation } from "../../src/web/lib/onboarding-state.js";

describe("desktop onboarding presentation", () => {
  it("reports an unavailable Atlas service without claiming FNGK needs setup", () => {
    expect(resolveOnboardingPresentation(undefined, "Network request failed")).toEqual({
      kind: "atlas-unavailable",
      title: "Atlas service unavailable",
      message: "Atlas could not check FNGK because its local service is unavailable.",
      action: "Retry Atlas connection",
    });
  });

  it("keeps a verified FNGK runtime out of setup and out of persistent notifications", () => {
    expect(resolveOnboardingPresentation({ state: "ready", local: { message: "FNGK is ready." } })).toMatchObject({
      kind: "quiet",
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  ATLAS_WORLD_VERSION,
  type AtlasObservatory,
} from "../../src/world/types.js";

describe("atlas.world.v2 observatory contract", () => {
  it("fixes the home geography and semantic budgets", () => {
    expect(ATLAS_WORLD_VERSION).toBe("atlas.world.v2");
    const value: AtlasObservatory = {
      identity: { id: "device:one", label: "kigathi", online: true },
      health: "healthy",
      phase: "running",
      summary: "Serving one application.",
      regions: [
        "applications",
        "data",
        "infrastructure",
        "development",
        "system",
        "external",
      ].map((id) => ({
        id: id as AtlasObservatory["regions"][number]["id"],
        label: id,
        health: "healthy",
        items: [],
        collapsedCount: 0,
      })),
      flows: [],
      attention: [],
      history: [],
      measuredAt: "2026-09-20T00:00:00.000Z",
      stale: false,
    };

    expect(value.regions.map((item) => item.id)).toEqual([
      "applications",
      "data",
      "infrastructure",
      "development",
      "system",
      "external",
    ]);
  });
});

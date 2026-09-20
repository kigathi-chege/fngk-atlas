import { describe, expect, it } from "vitest";
import { normalizeObservation } from "../../src/world/normalization.js";
import type { AtlasObservation } from "../../src/world/types.js";

const observation = (
  value: Partial<AtlasObservation> & Pick<AtlasObservation, "facts">,
): AtlasObservation => ({
  id: "observation:one",
  contextId: "local",
  kind: "process",
  source: "runtime",
  sourceId: "process:1",
  observedAt: "2026-09-20T00:00:00.000Z",
  sensitivity: "safe-metadata",
  ...value,
});

describe("operational observation normalization", () => {
  it("flattens allowlisted runtime metadata without leaking secrets", () => {
    const input = normalizeObservation(
      observation({
        facts: {
          label: "node",
          pid: 12,
          metadata: {
            pid: 99,
            cwd: "/srv/app",
            active: "active",
            state: "running",
            rssBytes: 2048,
            password: "never",
          },
        },
      }),
    );

    expect(input).toMatchObject({
      id: "observation:one",
      label: "node",
      source: "runtime",
      observedAt: "2026-09-20T00:00:00.000Z",
      attributes: {
        pid: 12,
        cwd: "/srv/app",
        activeState: "active",
        subState: "running",
        rssBytes: 2048,
      },
    });
    expect(JSON.stringify(input)).not.toContain("never");
  });

  it("accepts only valid ports and finite activity measurements", () => {
    expect(
      normalizeObservation(
        observation({
          facts: {
            metadata: {
              port: "5432",
              cpuPercent: 12.5,
              rssBytes: 4096,
              elapsedSeconds: 60,
              processState: "Ssl",
            },
          },
        }),
      ).attributes,
    ).toMatchObject({
      port: 5432,
      cpuPercent: 12.5,
      rssBytes: 4096,
      elapsedSeconds: 60,
      processState: "Ssl",
    });
    expect(
      normalizeObservation(
        observation({
          facts: {
            metadata: {
              port: "70000",
              cpuPercent: "not-a-number",
              rssBytes: -1,
              elapsedSeconds: -5,
            },
          },
        }),
      ).attributes,
    ).toEqual({});
  });
});

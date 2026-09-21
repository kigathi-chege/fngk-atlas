import { describe, expect, it } from "vitest";
import {
  deriveActiveFlows,
  evaluateOperationalState,
} from "../../src/world/health.js";
import { WorldStore } from "../../src/world/store.js";
import type {
  AtlasAssertion,
  AtlasEntity,
  InterpreterInput,
} from "../../src/world/types.js";

const entity = (attributes: Record<string, unknown> = {}): AtlasEntity => ({
  id: "workload:web",
  contextId: "local",
  kind: "workload",
  namespace: "atlas.resolver.v2",
  label: "web",
  aliases: [],
  attributes,
  firstObservedAt: "2026-09-20T00:00:00.000Z",
  lastObservedAt: "2026-09-20T00:00:00.000Z",
  stale: false,
});
const member = (attributes: Record<string, unknown>): InterpreterInput => ({
  id: "process:web",
  contextId: "local",
  kind: "process",
  label: "node",
  attributes,
  observedAt: "2026-09-20T00:00:00.000Z",
  source: "runtime",
});

describe("operational health", () => {
  it.each([
    ["running and ready", { activeState: "active", readiness: "ready" }, true, "healthy", "running", true],
    ["starting", { activeState: "activating" }, true, "unknown", "starting", true],
    ["stopped", { activeState: "inactive" }, true, "unknown", "idle", false],
    ["failed", { activeState: "failed" }, true, "critical", "failed", false],
    ["offline", { activeState: "failed" }, false, "stale", "failed", false],
    ["CPU pressure", { activeState: "active", readiness: "ready", cpuPercent: 95 }, true, "degraded", "running", true],
    ["memory pressure", { activeState: "active", readiness: "ready", memoryUtilization: 0.95 }, true, "degraded", "running", true],
    ["unknown", {}, true, "unknown", "unknown", false],
  ])(
    "derives %s without equating freshness with health",
    (_name, attributes, online, health, phase, active) => {
      expect(
        evaluateOperationalState(entity(), [member(attributes)], online),
      ).toMatchObject({ health, phase, active, reasons: expect.any(Array) });
    },
  );

  it("bounds samples and derives flows only from current scoped assertions", () => {
    const store = new WorldStore(":memory:"),
      start = Date.parse("2026-09-20T00:00:00.000Z");
    store.putSamples([
      {
        contextId: "local",
        entityId: "workload:web",
        metric: "cpuPercent",
        value: 1,
        unit: "percent",
        observedAt: "2026-09-18T00:00:00.000Z",
      },
      ...Array.from({ length: 10_002 }, (_, index) => ({
        contextId: "local",
        entityId: "workload:web",
        metric: "cpuPercent",
        value: index,
        unit: "percent",
        observedAt: new Date(start + index * 1000).toISOString(),
      })),
    ]);
    expect(store.samples("local")).toHaveLength(10_000);
    expect(
      store.samples(
        "local",
        "workload:web",
        "2026-09-20T00:00:02.000Z",
      )[0],
    ).toMatchObject({ value: 2 });

    const target = { ...entity(), id: "workload:postgres", label: "postgres" },
      assertion: AtlasAssertion = {
        id: "depends",
        contextId: "local",
        subjectId: "workload:web",
        predicate: "depends-on",
        objectId: "workload:postgres",
        classification: "observed",
        confidence: 0.9,
        explanation: "fixture",
        evidence: [{ observationId: "connection:one" }],
        interpreterId: "fixture",
        interpreterVersion: "1",
        observedAt: "2026-09-20T00:00:00.000Z",
        derivedAt: "2026-09-20T00:00:00.000Z",
        stale: false,
      };
    expect(deriveActiveFlows([entity(), target], [assertion])).toEqual([
      expect.objectContaining({
        sourceId: "workload:web",
        targetId: "workload:postgres",
        active: true,
      }),
    ]);
    expect(deriveActiveFlows([entity(), target], [])).toEqual([]);
    store.close();
  });
});

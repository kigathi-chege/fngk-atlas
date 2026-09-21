import { describe, expect, it } from "vitest";
import { buildObservatory } from "../../src/world/observatory.js";
import { projectWorld } from "../../src/world/projector.js";
import type { AtlasAssertion, AtlasEntity } from "../../src/world/types.js";
import type { WorldSample } from "../../src/world/store.js";

const at = "2026-09-20T12:00:00.000Z";
const entity = (
  id: string,
  kind: string,
  label: string,
  attributes: Record<string, unknown> = {},
  parentId?: string,
): AtlasEntity => ({
  id,
  contextId: "local",
  kind,
  namespace: "atlas.resolver.v2",
  label,
  aliases: [],
  ...(parentId ? { parentId } : {}),
  attributes,
  firstObservedAt: at,
  lastObservedAt: at,
  stale: false,
});
const assertion = (
  id: string,
  subjectId: string,
  predicate: string,
  objectId: string,
): AtlasAssertion => ({
  id,
  contextId: "local",
  subjectId,
  predicate,
  objectId,
  classification: "observed",
  confidence: 0.95,
  explanation: "fixture",
  evidence: [{ observationId: `observation:${id}` }],
  interpreterId: "fixture",
  interpreterVersion: "1",
  observedAt: at,
  derivedAt: at,
  stale: false,
});

const fixture = (online = true) => {
  const regions = [
      ["region:applications", "Applications", "applications"],
      ["region:data", "Data", "data"],
      ["region:infrastructure", "Infrastructure", "infrastructure"],
      ["region:development", "Development", "development"],
      ["region:system", "System", "system"],
      ["region:external", "External", "external"],
    ].map(([id, label, region]) =>
      entity(
        id,
        "topology-region",
        label,
        { region, collapsedCount: region === "system" ? 180 : 0 },
        "device:one",
      ),
    ),
    web = entity(
      "workload:web",
      "workload",
      "Web",
      {
        region: "applications",
        visibility: "primary",
        health: "healthy",
        phase: "running",
        active: true,
        confidence: 0.98,
      },
      "region:applications",
    ),
    postgres = entity(
      "workload:postgres",
      "workload",
      "PostgreSQL",
      {
        region: "data",
        visibility: "primary",
        health: "healthy",
        phase: "running",
        active: true,
        confidence: 0.99,
      },
      "region:data",
    ),
    worker = entity(
      "workload:worker",
      "workload",
      "Failed worker",
      {
        region: "applications",
        visibility: "primary",
        health: "degraded",
        phase: "failed",
        active: false,
        confidence: 0.97,
        healthReasons: ["Worker failed its last run."],
      },
      "region:applications",
    ),
    route = entity(
      "external:route",
      "external-system",
      "atlas.example.test",
      { health: "healthy", phase: "running", active: true },
      "region:external",
    ),
    device = entity("device:one", "device", "kigathi", { online }),
    entities = [device, ...regions, web, postgres, worker, route],
    assertions = [
      assertion("depends", web.id, "depends-on", postgres.id),
      assertion("exposes", web.id, "exposes", route.id),
    ],
    changes = [
      {
        id: 1,
        itemId: worker.id,
        itemType: "entity",
        changeType: "changed",
        interpreterId: "atlas.resolver.v2",
        changedAt: "2026-09-20T11:59:00.000Z",
        summary: { kind: "workload", label: "Failed worker" },
      },
    ],
    samples: WorldSample[] = [
      {
        contextId: "local",
        entityId: web.id,
        metric: "cpuPercent",
        value: 95,
        unit: "percent",
        observedAt: "2026-09-20T11:59:30.000Z",
      },
    ];
  if (!online)
    for (const value of entities) value.stale = value.kind !== "device";
  return { entities, assertions, changes, samples, web, postgres };
};

describe("Machine Observatory projection", () => {
  it("answers identity, activity, health, flow, and attention within budgets", () => {
    const { entities, assertions, changes, samples, web, postgres } = fixture(),
      model = buildObservatory(
        "device:one",
        entities,
        assertions,
        changes,
        samples,
        at,
      );
    expect(model.identity.label).toBe("kigathi");
    expect(model.phase).toBe("running");
    expect(model.health).toBe("degraded");
    expect(model.flows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: web.id,
          targetId: postgres.id,
          active: true,
        }),
      ]),
    );
    expect(model.attention.map((item) => item.text).join(" ")).toMatch(
      /worker|CPU/,
    );
    expect(model.regions.map((region) => region.id)).toEqual([
      "applications",
      "data",
      "infrastructure",
      "development",
      "system",
      "external",
    ]);
    expect(model.regions.flatMap((region) => region.items).length).toBeLessThanOrEqual(24);
    expect(model.flows.length).toBeLessThanOrEqual(12);
    expect(model.attention.length).toBeLessThanOrEqual(8);
    expect(model.history.length).toBeLessThanOrEqual(12);
    expect(
      projectWorld("local", entities, assertions, { lens: "overview" }, {
        changes,
        samples,
        now: at,
      }).observatory,
    ).toEqual(model);
  });

  it("is deterministic and uses last-observed language while offline", () => {
    const current = fixture(),
      left = buildObservatory(
        "device:one",
        [...current.entities].reverse(),
        [...current.assertions].reverse(),
        current.changes,
        current.samples,
        at,
      ),
      right = buildObservatory(
        "device:one",
        current.entities,
        current.assertions,
        current.changes,
        current.samples,
        at,
      );
    expect(left.regions).toEqual(right.regions);
    expect(left.flows).toEqual(right.flows);

    const offline = fixture(false),
      model = buildObservatory(
        "device:one",
        offline.entities,
        offline.assertions,
        offline.changes,
        offline.samples,
        at,
      );
    expect(model.health).toBe("stale");
    expect(model.summary).toContain("was last observed");
    expect(model.regions.flatMap((region) => region.items).every((item) => item.stale)).toBe(true);
    expect(model.flows.every((flow) => flow.stale)).toBe(true);
  });
});

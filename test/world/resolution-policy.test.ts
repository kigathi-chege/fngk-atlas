import { describe, expect, it } from "vitest";
import { resolveOperationalWorld } from "../../src/world/resolution-policy.js";
import type { InterpreterInput } from "../../src/world/types.js";

const input = (
  id: string,
  kind: string,
  label: string,
  attributes: Record<string, unknown> = {},
): InterpreterInput => ({
  id,
  contextId: "local",
  kind,
  label,
  attributes,
  observedAt: "2026-09-20T00:00:00.000Z",
  source: "fixture",
});

describe("operational workload resolution", () => {
  it("promotes intentional workloads and collapses low-value system inventory", () => {
    const inputs: InterpreterInput[] = [
      ...Array.from({ length: 180 }, (_, index) =>
        input(`inactive:${index}`, "service", `boot-helper-${index}.service`, {
          systemdUnit: `boot-helper-${index}.service`,
          activeState: "inactive",
          subState: "dead",
        }),
      ),
      ...Array.from({ length: 15 }, (_, index) =>
        input(`system:${index}`, "service", `system-${index}.service`, {
          systemdUnit: `system-${index}.service`,
          activeState: "active",
          subState: "running",
        }),
      ),
      input("database:postgres", "database", "postgresql", {
        databaseEngine: "postgresql",
        address: "127.0.0.1",
        port: 5432,
        activeState: "active",
      }),
      input("deployment:atlas", "deployment", "atlas-web", {
        managedDeploymentId: "deployment:atlas",
        repositoryPath: "/srv/atlas",
      }),
      input("repo:atlas", "repository", "atlas", {
        repositoryPath: "/srv/atlas",
      }),
      input("process:42", "process", "node", {
        cwd: "/srv/atlas",
        pid: 42,
        processState: "Ssl",
      }),
      input("process:unknown:1", "process", "node", { pid: 51 }),
      input("process:unknown:2", "process", "node", { pid: 52 }),
      input("process:unknown:3", "process", "node", { pid: 53 }),
    ];

    const result = resolveOperationalWorld(
      inputs,
      () => "2026-09-20T00:01:00.000Z",
    );

    expect(
      result.workloads
        .filter((item) => item.visibility === "primary")
        .map((item) => item.label)
        .sort(),
    ).toEqual(["atlas-web", "postgresql"]);
    expect(
      result.workloads.find((item) => item.label === "atlas-web")?.memberIds,
    ).toEqual(
      expect.arrayContaining([
        "repo:atlas",
        "process:42",
        "deployment:atlas",
      ]),
    );
    expect(result.aggregates).toMatchObject({
      system: 15,
      inactive: 180,
      unknown: 3,
    });
  });

  it("does not merge or promote weak identity coincidences", () => {
    const result = resolveOperationalWorld([
      input("process:old", "process", "node", { pid: 42 }),
      input("process:new", "process", "node", { pid: 42 }),
      input("port:one", "port", ":5432", { port: 5432 }),
      input("port:two", "port", ":5432", { port: 5432 }),
      input("repo:one", "repository", "one", {
        repositoryPath: "/srv/one",
      }),
      input("repo:two", "repository", "two", {
        repositoryPath: "/srv/two",
      }),
    ]);

    expect(result.workloads).toEqual([]);
    expect(result.mapping).toEqual({});
    expect(result.aggregates).toEqual({ system: 0, inactive: 0, unknown: 6 });
  });

  it("retains conflicting strong anchors instead of merging them", () => {
    const result = resolveOperationalWorld([
      input("deployment:one", "deployment", "one", {
        managedDeploymentId: "one",
        repositoryPath: "/srv/shared",
      }),
      input("deployment:two", "deployment", "two", {
        managedDeploymentId: "two",
        repositoryPath: "/srv/shared",
      }),
      input("repo:shared", "repository", "shared", {
        repositoryPath: "/srv/shared",
      }),
      input("process:shared", "process", "node", {
        cwd: "/srv/shared",
        processState: "S",
      }),
    ]);

    expect(result.workloads.map((item) => item.label).sort()).toEqual([
      "one",
      "two",
    ]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      anchors: ["deployment:one", "deployment:two"],
    });
  });
});

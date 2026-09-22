import { describe, expect, it } from "vitest";
import { RuntimeDiscovery } from "../../src/discovery/runtime-discovery.js";
import type { CommandExecutor } from "../../src/transports/terminal-command.js";

describe("runtime census", () => {
  it("maps processes, services, containers, and ports while redacting command secrets", async () => {
    const executor: CommandExecutor = {
      execute: async (command) => {
        if (command.startsWith("ps "))
          return {
            output: Buffer.from(
              "12 1 root node 12.5 2048 300 Ssl node server.js --token super-secret\n",
            ),
            exitCode: 0,
          };
        if (command.includes("/proc/[0-9]*/cwd"))
          return {
            output: Buffer.from(
              `12 ${Buffer.from("/srv/signal").toString("base64")}\n`,
            ),
            exitCode: 0,
          };
        if (command.includes("/proc/[0-9]*/cgroup"))
          return { output: Buffer.from("12 signal.service\n"), exitCode: 0 };
        if (command.startsWith("systemctl "))
          return {
            output: Buffer.from(
              "postgresql.service loaded active running PostgreSQL\n",
            ),
            exitCode: 0,
          };
        if (command.startsWith("docker "))
          return {
            output: Buffer.from(
              '{"ID":"abc","Image":"node:24","Names":"signal","Status":"Up"}\n',
            ),
            exitCode: 0,
          };
        if (command.includes("ss -H -lntup"))
          return {
            output: Buffer.from(
              'tcp LISTEN 0 511 127.0.0.1:4317 0.0.0.0:* users:(("node",pid=12,fd=20))\n',
            ),
            exitCode: 0,
          };
        return { output: Buffer.alloc(0), exitCode: 127 };
      },
    };
    const entities = await new RuntimeDiscovery(executor).scan(
      "device:one",
      "terminal:one",
    );
    expect(entities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "process",
          metadata: expect.objectContaining({
            pid: 12,
            cwd: "/srv/signal",
            systemdUnit: "signal.service",
            cpuPercent: 12.5,
            rssBytes: 2_097_152,
            elapsedSeconds: 300,
            processState: "Ssl",
            command: expect.stringContaining("[redacted]"),
          }),
        }),
        expect.objectContaining({
          type: "service",
          name: "postgresql.service",
          metadata: expect.objectContaining({
            systemdUnit: "postgresql.service",
          }),
        }),
        expect.objectContaining({ type: "container", name: "signal" }),
        expect.objectContaining({ type: "port", name: "127.0.0.1:4317" }),
      ]),
    );
    expect(JSON.stringify(entities)).not.toContain("super-secret");
  });
});

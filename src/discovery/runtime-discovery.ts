import { createHash } from "node:crypto";
import type { CommandExecutor } from "../transports/terminal-command.js";
import type { DiscoveredEntity } from "./host-discovery.js";
import { redactCommandLine } from "./redaction.js";

const id = (context: string, type: string, name: string) =>
  createHash("sha256")
    .update(`${context}\0${type}\0${name}`)
    .digest("hex")
    .slice(0, 32);

export class RuntimeDiscovery {
  constructor(readonly executor: CommandExecutor) {}
  async scan(
    contextId: string,
    routeId: string,
    signal?: AbortSignal,
  ): Promise<DiscoveredEntity[]> {
    const entities: DiscoveredEntity[] = [],
      metadata = (value: Record<string, unknown>) => ({ ...value, routeId });
    const attempt = async (command: string) => {
      if (signal?.aborted)
        throw Object.assign(new Error("Discovery cancelled."), {
          code: "cancelled",
        });
      try {
        const result = await this.executor.execute(command, {
          timeoutMs: 10_000,
          signal,
        });
        return result.exitCode === 0 ? result.output.toString("utf8") : "";
      } catch (error) {
        if (signal?.aborted) throw error;
        return "";
      }
    };
    const workingDirectories = new Map<number, string>(),
      systemdUnits = new Map<number, string>();
    for (const line of (
      await attempt(
        `for p in /proc/[0-9]*/cwd; do value=$(readlink "$p" 2>/dev/null) || continue; pid="\${p#/proc/}"; pid="\${pid%/cwd}"; printf '%s ' "$pid"; printf '%s' "$value" | base64 | tr -d '\\n'; printf '\\n'; done`,
      )
    ).split(/\r?\n/)) {
      const match = line.match(/^(\d+)\s+([A-Za-z0-9+/=]+)$/);
      if (!match) continue;
      try {
        workingDirectories.set(
          Number(match[1]),
          Buffer.from(match[2], "base64").toString("utf8"),
        );
      } catch {}
    }
    for (const line of (
      await attempt(
        `for p in /proc/[0-9]*/cgroup; do unit=$(sed -n 's#.*[/]\\([^/]*[.]service\\)\\(/.*\\)\{0,1\}$#\\1#p' "$p" 2>/dev/null | head -n1); [ -n "$unit" ] || continue; pid="\${p#/proc/}"; pid="\${pid%/cgroup}"; printf '%s %s\\n' "$pid" "$unit"; done`,
      )
    ).split(/\r?\n/)) {
      const match = line.match(/^(\d+)\s+(\S+\.service)$/);
      if (match) systemdUnits.set(Number(match[1]), match[2]);
    }
    for (const line of (
      await attempt(`ps -eo pid=,ppid=,user=,comm=,pcpu=,rss=,etimes=,stat=,args=`)
    ).split(/\r?\n/)) {
      const match = line
        .trim()
        .match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
      if (!match) continue;
      const [
        ,
        pid,
        ppid,
        user,
        executable,
        cpuPercent,
        rssKiB,
        elapsedSeconds,
        processState,
        command,
      ] = match;
      entities.push({
        id: id(contextId, "process", pid),
        contextId,
        type: "process",
        name: executable,
        path: "",
        metadata: metadata({
          pid: Number(pid),
          ppid: Number(ppid),
          user,
          executable,
          command: redactCommandLine(command),
          cpuPercent: Number(cpuPercent),
          rssBytes: Number(rssKiB) * 1024,
          elapsedSeconds: Number(elapsedSeconds),
          processState,
          cwd: workingDirectories.get(Number(pid)),
          systemdUnit: systemdUnits.get(Number(pid)),
        }),
      });
    }
    for (const line of (
      await attempt(
        `systemctl list-units --type=service --all --no-legend --no-pager`,
      )
    ).split(/\r?\n/)) {
      const fields = line.trim().split(/\s+/);
      if (!fields[0]?.endsWith(".service")) continue;
      entities.push({
        id: id(contextId, "service", fields[0]),
        contextId,
        type: "service",
        name: fields[0],
        path: "",
        metadata: metadata({
          systemdUnit: fields[0],
          load: fields[1],
          active: fields[2],
          state: fields[3],
          description: fields.slice(4).join(" "),
        }),
      });
    }
    for (const line of (
      await attempt(`docker ps --no-trunc --format '{{json .}}'`)
    ).split(/\r?\n/)) {
      try {
        const value = JSON.parse(line);
        if (!value.ID) continue;
        entities.push({
          id: id(contextId, "container", value.ID),
          contextId,
          type: "container",
          name: value.Names || value.ID,
          path: "",
          metadata: metadata({
            containerId: value.ID,
            image: value.Image,
            status: value.Status,
          }),
        });
      } catch {}
    }
    for (const line of (await attempt(`if command -v ss >/dev/null 2>&1; then ss -H -lntup; elif command -v lsof >/dev/null 2>&1; then lsof -nP -iTCP -sTCP:LISTEN -Fpcn 2>/dev/null | awk '/^p/{pid=substr($0,2)} /^n/{printf "tcp LISTEN 0 0 %s users:((pid=%s))\\n",substr($0,2),pid}'; fi`)).split(/\r?\n/)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 5) continue;
      const address = fields[4];
      if (!address?.includes(":")) continue;
      const pid = line.match(/pid=(\d+)/)?.[1];
      entities.push({
        id: id(contextId, "port", `${fields[0]}:${address}`),
        contextId,
        type: "port",
        name: address,
        path: "",
        metadata: metadata({
          protocol: fields[0],
          state: fields[1],
          address,
          port: Number(address.match(/:(\d+)$/)?.[1]),
          pid: pid ? Number(pid) : undefined,
        }),
      });
    }
    return entities;
  }
}

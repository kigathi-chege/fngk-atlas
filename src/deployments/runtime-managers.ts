import type { CommandExecutor } from '../transports/terminal-command.js';
import type { RuntimeManager } from './project-manifest.js';

// systemd counts only when it is the running init, not merely installed.
const PROBE = "for tool in pm2 supervisorctl docker; do command -v \"$tool\" >/dev/null 2>&1 && printf '%s\\n' \"$tool\"; done; if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then printf 'systemd\\n'; fi";
const MANAGERS: Record<string, RuntimeManager> = { pm2: 'pm2', supervisorctl: 'supervisor', docker: 'docker', systemd: 'systemd' };

/** Runtime managers the Device can run, or undefined when it cannot be asked. */
export async function availableRuntimeManagers(executor: CommandExecutor, signal?: AbortSignal): Promise<RuntimeManager[] | undefined> {
  try {
    const result = await executor.execute(PROBE, { signal, timeoutMs: 10_000 });
    return [...new Set(result.output.toString('utf8').split(/\r?\n/).map(line => MANAGERS[line.trim()]).filter((value): value is RuntimeManager => Boolean(value)))];
  } catch {
    return undefined;
  }
}

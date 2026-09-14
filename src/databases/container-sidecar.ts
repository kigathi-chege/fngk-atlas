import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { hostname } from 'node:os';
import { promisify } from 'node:util';
import type { DatabaseConnection, DatabaseRuntime, DatabaseSession } from './types.js';

const execute = promisify(execFile);
const minimumVersion = [7, 1, 9] as const;

type RuntimeRecord = {
  session: DatabaseSession;
  token: string;
  origin: string;
  container: string;
  timer: NodeJS.Timeout;
};

function isSafeImage(image: string): boolean {
  const version = image.match(/:(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number);
  if (!version) return false;
  const [major, minor, patch] = version;
  return major > minimumVersion[0]
    || (major === minimumVersion[0] && (minor > minimumVersion[1]
      || (minor === minimumVersion[1] && patch >= minimumVersion[2])));
}

async function isContainerized(): Promise<boolean> {
  return process.env.DOCKER_CONTAINER === '1'
    || await readFile('/.dockerenv').then(() => true).catch(() => false);
}

async function freePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No loopback port available.'));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function currentContainerId(docker: string): Promise<string | undefined> {
  const ids = (await execute(docker, ['ps', '-q'])).stdout.trim().split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const configuredHostname = (await execute(docker, ['inspect', '--format', '{{.Config.Hostname}}', id])).stdout.trim();
    if (configuredHostname === hostname()) return id;
  }
  return undefined;
}

export class DbGateContainerSupervisor implements DatabaseRuntime {
  #records = new Map<string, RuntimeRecord>();

  constructor(readonly options: {
    image?: string;
    ttlMs?: number;
    startupMs?: number;
    docker?: string;
  } = {}) {}

  async start(connection: DatabaseConnection) {
    const image = this.options.image ?? process.env.DBGATE_IMAGE ?? 'dbgate/dbgate:7.2.6';
    if (!isSafeImage(image)) {
      throw Object.assign(new Error('DbGate image 7.1.9 or newer with an exact version tag is required.'), { code: 'unsafe_sidecar_version' });
    }

    const id = randomUUID();
    const container = `fngk-atlas-dbgate-${id.slice(0, 12)}`;
    const token = randomBytes(24).toString('base64url');
    const ttl = this.options.ttlMs ?? 30 * 60_000;
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + ttl);
    const proxyPath = `/api/databases/sessions/${id}/workbench/`;
    const docker = this.options.docker ?? 'docker';
    const containerId = await isContainerized() ? await currentContainerId(docker) : undefined;
    const sharedPort = containerId ? await freePort() : 3000;
    const environment: Record<string, string> = {
      HOME: '/tmp',
      PORT: String(sharedPort),
      WEB_ROOT: proxyPath,
      CONNECTIONS: 'atlas',
      LABEL_atlas: connection.label ?? connection.database ?? connection.engine,
      SERVER_atlas: connection.host,
      PORT_atlas: String(connection.port ?? ''),
      DATABASE_atlas: connection.database ?? '',
      USER_atlas: connection.user ?? '',
      PASSWORD_atlas: connection.password ?? '',
      ENGINE_atlas: `${connection.engine}@dbgate-plugin-${connection.engine === 'mariadb' ? 'mysql' : connection.engine}`,
      READONLY_atlas: connection.readOnly ? '1' : '0',
      SHELL_SCRIPTING: '0',
      SHELL_CONNECTION: '0',
      TOKEN_LIFETIME: `${Math.ceil(ttl / 1000)}s`,
      NODE_ENV: 'production',
    };
    const args = [
      'run', '-d', '--rm', '--name', container,
      '--user', '65532:65532', '--read-only', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--memory', '768m',
      '--tmpfs', '/tmp:rw,nosuid,noexec,size=96m',
    ];
    if (containerId) args.push('--network', `container:${containerId}`);
    else args.push('-p', '127.0.0.1::3000');
    for (const [key, value] of Object.entries(environment)) args.push('-e', `${key}=${value}`);
    args.push(image);

    let startedContainerId: string;
    try {
      startedContainerId = (await execute(docker, args, { maxBuffer: 128 * 1024 })).stdout.trim();
    } catch (error) {
      throw Object.assign(new Error(`DbGate container could not start: ${(error as Error).message}`), { code: 'sidecar_start_failed' });
    }

    const session: DatabaseSession = {
      id, contextId: connection.contextId, engine: connection.engine,
      label: connection.label ?? connection.database ?? connection.engine,
      status: 'starting', createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(),
      proxyPath, runtimeId: startedContainerId.slice(0, 12),
    };

    try {
      let port = sharedPort;
      if (!containerId) {
        const published = (await execute(docker, ['port', container, '3000/tcp'])).stdout.trim().split(/\n/)[0];
        port = Number(published.match(/:(\d+)$/)?.[1]);
        if (!port) throw new Error('DbGate did not publish its loopback port.');
      }
      const origin = `http://127.0.0.1:${port}`;
      const deadline = Date.now() + (this.options.startupMs ?? 30_000);
      while (Date.now() < deadline) {
        try {
          const response = await fetch(`${origin}${proxyPath}`, { redirect: 'manual' });
          if (response.status < 500) {
            session.status = 'live';
            const timer = setTimeout(() => void this.stop(id, 'expired'), ttl);
            timer.unref();
            this.#records.set(id, { session, token, origin, container, timer });
            return { session: { ...session }, token, origin };
          }
        } catch {
          // The container is still starting.
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error('DbGate container did not become ready.');
    } catch (error) {
      await execute(docker, ['rm', '-f', container]).catch(() => {});
      throw Object.assign(error as Error, { code: 'sidecar_start_failed' });
    }
  }

  list(): DatabaseSession[] {
    return [...this.#records.values()].map((value) => ({ ...value.session }));
  }

  get(id: string) {
    const value = this.#records.get(id);
    return value ? { session: { ...value.session }, token: value.token, origin: value.origin } : undefined;
  }

  async stop(id: string, reason: 'stopped' | 'expired' = 'stopped'): Promise<boolean> {
    const value = this.#records.get(id);
    if (!value) return false;
    this.#records.delete(id);
    clearTimeout(value.timer);
    value.session.status = reason;
    await execute(this.options.docker ?? 'docker', ['rm', '-f', value.container]).catch(() => {});
    return true;
  }

  async close(): Promise<void> {
    await Promise.all([...this.#records.keys()].map((id) => this.stop(id)));
  }
}

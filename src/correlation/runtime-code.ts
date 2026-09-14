import { createHash } from 'node:crypto';

export interface RuntimeEdge { id: string; source: string; target: string; type: string; confidence: 'exact' | 'high' | 'medium'; evidence: Record<string, unknown> }
const edge = (source: string, target: string, type: string, confidence: RuntimeEdge['confidence'], evidence: Record<string, unknown>): RuntimeEdge => ({ id: `runtime:${createHash('sha256').update(`${source}\0${target}\0${type}`).digest('hex').slice(0, 20)}`, source, target, type, confidence, evidence });
const slash = (value: string) => value.replaceAll('\\', '/').replace(/\/$/, '');

export function correlateRuntime(index: { nodes: any[] }, runtime: any[]): RuntimeEdge[] {
  const edges: RuntimeEdge[] = [], repositories = index.nodes.filter(node => node.type === 'repository'), modules = index.nodes.filter(node => node.type === 'module'), byId = new Map(index.nodes.map(node => [node.id, node]));
  const belongsTo = (node: any, repositoryId: string) => { let current = node; const seen = new Set<string>(); while (current?.parent && !seen.has(current.parent)) { if (current.parent === repositoryId) return true; seen.add(current.parent); current = byId.get(current.parent); } return false; };
  const processes = runtime.filter(item => item.type === 'process'), processByPid = new Map(processes.map(item => [Number(item.metadata?.pid), item]));
  for (const process of processes) {
    const cwd = slash(String(process.metadata?.cwd ?? '')), command = slash(String(process.metadata?.command ?? ''));
    for (const repository of repositories) {
      const root = slash(String(repository.root ?? repository.path ?? '')); if (!root) continue;
      if (cwd === root || cwd.startsWith(`${root}/`)) edges.push(edge(process.id, repository.id, 'runtime_in', 'high', { kind: 'cwd', value: cwd }));
      for (const module of modules.filter(value => belongsTo(value, repository.id))) {
        const absolute = `${root}/${slash(String(module.path ?? ''))}`;
        const relative=slash(String(module.path??'')),resolvedFromCwd=cwd&&relative?`${cwd}/${relative}`:'';
        if (command.includes(absolute)||(resolvedFromCwd===absolute&&command.includes(relative))) edges.push(edge(process.id, module.id, 'loads', 'high', { kind: 'command_path', value: absolute }));
      }
    }
  }
  for (const item of runtime.filter(value => value.type === 'port')) {
    const process = processByPid.get(Number(item.metadata?.pid)); if (process) edges.push(edge(item.id, process.id, 'served_by', 'exact', { kind: 'pid', value: item.metadata.pid }));
  }
  return [...new Map(edges.map(value => [value.id, value])).values()];
}

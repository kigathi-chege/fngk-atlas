export type GraphLens = 'world' | 'machine' | 'code' | 'function' | 'execution';
export interface GraphSource { nodes: any[]; edges: any[] }
export interface GraphOptions { lens: GraphLens; root?: string; budget?: number; layers?: Set<string> }
const types: Record<GraphLens, Set<string>> = {
  world: new Set(['profile', 'team', 'device', 'connection', 'context', 'adapter', 'resource']),
  machine: new Set(['device', 'filesystem', 'directory', 'repository', 'service', 'process', 'container', 'port']),
  code: new Set(['repository', 'package', 'module', 'function', 'external', 'endpoint', 'event', 'table', 'flow']),
  function: new Set(['function', 'test', 'module']),
  execution: new Set(['repository', 'package', 'module', 'function', 'test', 'command', 'terminal', 'process', 'output', 'coverage', 'file', 'endpoint', 'event', 'table', 'flow']),
};
const key = (edge: any) => `${edge.source}\0${edge.target}\0${edge.type}`;

function stronglyConnected(nodes: any[], edges: any[]): string[][] {
  const ids = new Set(nodes.filter(node => node.type === 'module').map(node => node.id)), adjacent = new Map<string, string[]>();
  for (const id of ids) adjacent.set(id, []); for (const edge of edges) if (edge.type === 'imports' && ids.has(edge.source) && ids.has(edge.target)) adjacent.get(edge.source)!.push(edge.target);
  let cursor = 0; const indexes = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], stacked = new Set<string>(), groups: string[][] = [];
  const visit = (id: string) => { indexes.set(id, cursor); low.set(id, cursor++); stack.push(id); stacked.add(id); for (const target of adjacent.get(id) ?? []) { if (!indexes.has(target)) { visit(target); low.set(id, Math.min(low.get(id)!, low.get(target)!)); } else if (stacked.has(target)) low.set(id, Math.min(low.get(id)!, indexes.get(target)!)); } if (low.get(id) === indexes.get(id)) { const group: string[] = []; let value: string; do { value = stack.pop()!; stacked.delete(value); group.push(value); } while (value !== id); if (group.length > 1) groups.push(group.sort()); } };
  for (const id of ids) if (!indexes.has(id)) visit(id); return groups;
}

export function buildGraphLens(source: GraphSource, options: GraphOptions): GraphSource {
  const layers = options.layers ?? new Set(['contains', 'depends_on', 'imports', 'calls', 'handles', 'requests', 'emits', 'subscribes', 'queries', 'flows_to', 'runtime_in', 'loads', 'served_by', 'coverage', 'deployment']), allowed = types[options.lens];
  let nodes = source.nodes.filter(node => allowed.has(node.type)), ids = new Set(nodes.map(node => node.id)), edges = source.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target) && layers.has(edge.type));
  if (options.lens === 'code' && !options.root) {
    nodes = nodes.filter(node => node.type !== 'function'); ids = new Set(nodes.map(node => node.id)); edges = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target));
  }
  if (options.root) { const neighborhood = new Set([options.root]); for (const edge of edges) if (edge.source === options.root || edge.target === options.root) { neighborhood.add(edge.source); neighborhood.add(edge.target); } nodes = nodes.filter(node => neighborhood.has(node.id)); ids = new Set(nodes.map(node => node.id)); edges = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)); }
  const groups = stronglyConnected(nodes, edges), replacement = new Map<string, string>();
  for (const members of groups) for (const member of members) replacement.set(member, `cycle:${members.join(':')}`);
  if (groups.length) { nodes = nodes.filter(node => !replacement.has(node.id)); for (const members of groups) nodes.push({ id: `cycle:${members.join(':')}`, type: 'cycle', label: `${members.length} module cycle`, members }); edges = [...new Map(edges.map(edge => { const sourceId = replacement.get(edge.source) ?? edge.source, targetId = replacement.get(edge.target) ?? edge.target; return { ...edge, id: `${edge.type}:${sourceId}:${targetId}`, source: sourceId, target: targetId }; }).filter(edge => edge.source !== edge.target).map(edge => [key(edge), edge])).values()]; }
  const priority:Record<string,number>={profile:0,device:1,repository:2,package:3,cycle:4,module:5,external:6,function:7,test:8,process:9,service:10,container:11,port:12,file:13};
  nodes.sort((left, right) => (priority[left.type]??50)-(priority[right.type]??50)||`${left.label ?? left.name ?? left.id}`.localeCompare(`${right.label ?? right.name ?? right.id}`));
  const budget = Math.max(1, options.budget ?? 80); if (nodes.length > budget) { const hidden = nodes.length - budget; nodes = [...nodes.slice(0, budget), { id: `aggregate:${options.lens}:${hidden}`, type: 'aggregate', label: `Expand ${hidden} more`, hidden }]; }
  ids = new Set(nodes.map(node => node.id)); edges = edges.filter(edge => ids.has(edge.source) && ids.has(edge.target)); return { nodes, edges };
}

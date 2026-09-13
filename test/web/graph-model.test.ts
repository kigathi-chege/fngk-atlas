import { describe, expect, it } from 'vitest';
import { buildGraphLens } from '../../src/web/lib/graph-model.js';

describe('bounded graph lenses', () => {
  it('groups import cycles and adds an explicit expansion node at the budget', () => {
    const nodes = Array.from({ length: 8 }, (_, index) => ({ id: `m${index}`, type: 'module', label: `module ${index}` }));
    const edges = [
      { id: 'a', source: 'm0', target: 'm1', type: 'imports' }, { id: 'b', source: 'm1', target: 'm0', type: 'imports' },
      ...Array.from({ length: 6 }, (_, index) => ({ id: `e${index}`, source: `m${index + 1}`, target: `m${index + 2}`, type: 'imports' })),
    ];
    const graph = buildGraphLens({ nodes, edges }, { lens: 'code', budget: 4, layers: new Set(['imports']) });
    expect(graph.nodes).toContainEqual(expect.objectContaining({ type: 'cycle', members: ['m0', 'm1'] }));
    expect(graph.nodes).toContainEqual(expect.objectContaining({ type: 'aggregate', hidden: expect.any(Number) }));
    expect(graph.nodes.length).toBeLessThanOrEqual(5);
  });

  it('focuses a function on its one-hop callers and callees', () => {
    const source = { nodes: [{ id: 'a', type: 'function' }, { id: 'b', type: 'function' }, { id: 'c', type: 'function' }, { id: 'unrelated', type: 'function' }], edges: [{ id: 'ab', source: 'a', target: 'b', type: 'calls' }, { id: 'bc', source: 'b', target: 'c', type: 'calls' }] };
    expect(buildGraphLens(source, { lens: 'function', root: 'b', budget: 20, layers: new Set(['calls']) }).nodes.map(node => node.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('keeps process-to-module runtime evidence in the execution lens', () => {
    const source = { nodes: [{ id: 'process', type: 'process' }, { id: 'module', type: 'module' }], edges: [{ id: 'loads', source: 'process', target: 'module', type: 'loads' }] };
    const graph = buildGraphLens(source, { lens: 'execution', budget: 20, layers: new Set(['loads']) });
    expect(graph.nodes.map(node => node.id).sort()).toEqual(['module', 'process']);
    expect(graph.edges).toEqual([expect.objectContaining({ type: 'loads' })]);
  });
});

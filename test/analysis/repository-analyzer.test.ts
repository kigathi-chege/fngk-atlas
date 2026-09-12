import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeRepository } from '../../src/analysis/repository-analyzer.js';
import { FileService } from '../../src/files/file-service.js';
import { DirectTransport } from '../../src/transports/direct.js';

const directories: string[] = [];
afterEach(async () => { while (directories.length) await rm(directories.pop()!, { recursive: true, force: true }); });

describe('transport-neutral repository analysis', () => {
  it('streams stable modules, functions, arguments, imports, calls, and sizes from a FileService', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'atlas-analysis-source-')); directories.push(root); await mkdir(path.join(root, 'repo', 'src'), { recursive: true });
    await writeFile(path.join(root, 'repo', 'package.json'), '{"name":"remote-fixture","dependencies":{"zod":"1.0.0"}}');
    await writeFile(path.join(root, 'repo', 'src', 'b.ts'), 'export function double(value:number){ return value * 2 }');
    await writeFile(path.join(root, 'repo', 'src', 'a.ts'), "import {double} from './b'; export function calculate(value:number, fallback=0){ if(value > 0) return double(value); return fallback }");
    const files = new FileService([new DirectTransport({ id: 'direct', contextId: 'remote', root })]);
    const collect = async () => { const batches = []; for await (const batch of analyzeRepository({ contextId: 'remote', path: '/repo' }, files)) batches.push(batch); return batches.at(-1)!.index; };
    const first = await collect(), second = await collect(), calculate = first.nodes.find((node: any) => node.type === 'function' && node.name === 'calculate');
    expect(calculate).toMatchObject({ arity: 2, requiredArity: 1, physicalLines: 1, complexity: 2 });
    expect(first.edges).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'imports' }), expect.objectContaining({ type: 'calls' }), expect.objectContaining({ type: 'depends_on' })]));
    expect(second.nodes.find((node: any) => node.name === 'calculate').id).toBe(calculate.id);
  });
});

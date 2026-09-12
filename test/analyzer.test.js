import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyze } from '../src/analyzer.js';

test('indexes packages, functions, arguments, calls, and complexity', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'atlas-analysis-'));
  try {
    await mkdir(path.join(root,'src'));
    await writeFile(path.join(root,'package.json'),JSON.stringify({name:'fixture',dependencies:{zod:'1.0.0'}}));
    await writeFile(path.join(root,'src','math.ts'),`
      export function double(value: number) { return value * 2 }
      export async function calculate(value: number, fallback = 0, ...rest: number[]) {
        if (value > 0 && rest.length) return double(value)
        return fallback
      }
    `);
    await writeFile(path.join(root,'src','worker.py'),`
def classify(value, fallback=None):
    if value:
        return value
    return fallback
`);
    const result=await analyze(root);
    const calculate=result.nodes.find(n=>n.type==='function'&&n.name==='calculate');
    assert.equal(result.summary.files,2);
    assert.equal(result.summary.packages,1);
    assert.equal(calculate.arity,3);
    assert.equal(calculate.requiredArity,1);
    assert.ok(calculate.complexity>=3);
    assert.ok(result.edges.some(e=>e.type==='depends_on'));
    assert.ok(result.edges.some(e=>e.type==='calls'));
    assert.ok(result.nodes.some(n=>n.language==='Python'&&n.name==='classify'));
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('assigns stable symbol identifiers for unchanged code', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'atlas-stability-'));
  try {
    await writeFile(path.join(root,'main.js'),'export function stable(a) { return a }');
    const first=await analyze(root),second=await analyze(root);
    assert.equal(first.nodes.find(n=>n.name==='stable').id,second.nodes.find(n=>n.name==='stable').id);
    assert.equal(first.fingerprint,second.fingerprint);
  } finally { await rm(root,{recursive:true,force:true}); }
});

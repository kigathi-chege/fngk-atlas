import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyze } from '../src/analyzer.js';
import { runFunction } from '../src/sandbox.js';

test('runs an exported module function with explicit arguments in the Node permission sandbox', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'atlas-run-'));
  try {
    await writeFile(path.join(root,'math.mjs'),'export function add(left, right) { return left + right }');
    const index=await analyze(root);const symbol=index.nodes.find(n=>n.type==='function'&&n.name==='add');
    const run=await runFunction(index,symbol.id,{args:[20,22],timeoutMs:3000});
    assert.equal(run.status,'completed');
    assert.match(run.stdout,/42/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('does not claim unsupported runtimes are runnable', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'atlas-run-'));
  try {
    await writeFile(path.join(root,'main.go'),'package main\nfunc Add(left int, right int) int { return left + right }');
    const index=await analyze(root);const symbol=index.nodes.find(n=>n.type==='function');
    assert.deepEqual(symbol.parameters.map(parameter=>parameter.name),['left','right']);
    await assert.rejects(()=>runFunction(index,symbol.id,{args:[1,2]}),/No safe disposable harness/);
  } finally { await rm(root,{recursive:true,force:true}); }
});

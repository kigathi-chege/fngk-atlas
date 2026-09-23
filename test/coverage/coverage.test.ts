import { describe, expect, it } from 'vitest';
import { attachCoverage, coverageForSpan, parseCobertura, parseGoCover, parseLcov } from '../../src/coverage/coverage.js';
import { crap } from '../../src/coverage/crap.js';

describe('coverage normalization and CRAP', () => {
  it('parses LCOV, Cobertura/coverage.py, and Go cover profiles', () => {
    expect(parseLcov('SF:/repo/src/a.ts\nDA:1,1\nDA:2,0\nend_of_record\n', { source: 'lcov.info', revision: 'abc' }).files['/repo/src/a.ts'].lines).toEqual({ 1: 1, 2: 0 });
    expect(parseCobertura('<coverage><class filename="src/a.py"><lines><line number="3" hits="2"/><line number="4" hits="0"/></lines></class></coverage>', { source: 'coverage.xml' }).files['src/a.py'].lines).toEqual({ 3: 2, 4: 0 });
    expect(parseGoCover('mode: set\nexample/pkg/a.go:2.1,4.2 3 1\nexample/pkg/a.go:6.1,6.9 1 0\n', { source: 'cover.out' }).files['example/pkg/a.go'].lines).toEqual({ 2: 1, 3: 1, 4: 1, 6: 0 });
  });

  it('matches function spans and calculates the hand-checked CRAP formula', () => {
    const coverage = parseLcov('SF:src/a.ts\nDA:10,1\nDA:11,0\nend_of_record\n', { source: 'lcov.info', revision: 'abc', revisionVerified: true });
    expect(coverageForSpan(coverage, 'src/a.ts', 10, 11)).toEqual({ covered: 1, executable: 2, fraction: 0.5 });
    expect(crap(10, 0.8)).toBeCloseTo(10.8, 8);
    const index = { nodes: [{ id: 'fn', type: 'function', path: 'src/a.ts', line: 10, endLine: 11, complexity: 10 }] };
    expect(attachCoverage(index, coverage, 'abc').nodes[0]).toMatchObject({ coverage: { fraction: 0.5, stale: false, source: 'lcov.info' }, crap: 22.5 });
  });

  it('marks mismatched revisions stale and never invents CRAP without matched coverage', () => {
    const coverage = parseLcov('SF:src/a.ts\nDA:10,1\nend_of_record\n', { source: 'lcov.info', revision: 'old', revisionVerified: true });
    const index = { nodes: [
      { id: 'covered', type: 'function', path: 'src/a.ts', line: 10, endLine: 10, complexity: 2 },
      { id: 'missing', type: 'function', path: 'src/missing.ts', line: 1, endLine: 2, complexity: 5 },
    ] };
    const result = attachCoverage(index, coverage, 'new');
    expect(result.nodes[0]).toMatchObject({ coverage: { stale: true }, crap: null });
    expect(result.nodes[1]).toMatchObject({ coverage: null, crap: null });
  });
});

import { describe, expect, it } from 'vitest';
import { coverageCommands } from '../../src/coverage/commands.js';

describe('coverage command detection', () => {
  it('prefers declared coverage scripts and offers tests without claiming they generate coverage', () => {
    expect(coverageCommands({ scripts: { test: 'vitest', coverage: 'vitest --coverage', 'test:coverage': 'jest --coverage' } })).toEqual([
      { label: 'npm run coverage', command: 'npm run coverage', producesCoverage: true },
      { label: 'npm run test:coverage', command: 'npm run test:coverage', producesCoverage: true },
      { label: 'npm test', command: 'npm test', producesCoverage: false },
    ]);
  });
});

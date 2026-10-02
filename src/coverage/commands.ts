export interface CoverageCommand { label: string; command: string; producesCoverage: boolean }
export function coverageCommands(manifest: { scripts?: Record<string, string> }): CoverageCommand[] {
  const scripts = manifest.scripts ?? {}, values: CoverageCommand[] = [];
  for (const name of ['coverage', 'test:coverage']) if (scripts[name]) values.push({ label: `npm run ${name}`, command: `npm run ${name}`, producesCoverage: true });
  if (scripts.test) values.push({ label: 'npm test', command: 'npm test', producesCoverage: false });
  return values;
}

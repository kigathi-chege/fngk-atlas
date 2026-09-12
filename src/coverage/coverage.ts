import { crap, CRAP_FORMULA_VERSION } from './crap.js';

export interface CoverageFile { path: string; lines: Record<number, number> }
export interface CoverageEvidence { format: 'lcov' | 'cobertura' | 'go'; source: string; revision?: string; revisionVerified: boolean; collectedAt: string; files: Record<string, CoverageFile> }
interface EvidenceOptions { source: string; revision?: string; revisionVerified?: boolean; collectedAt?: string }
const normalized = (value: string) => value.replaceAll('\\', '/').replace(/^\.\//, '');
const evidence = (format: CoverageEvidence['format'], files: Record<string, CoverageFile>, options: EvidenceOptions): CoverageEvidence => ({ format, source: options.source, revision: options.revision, revisionVerified: options.revisionVerified ?? false, collectedAt: options.collectedAt ?? new Date().toISOString(), files });

export function parseLcov(text: string, options: EvidenceOptions): CoverageEvidence {
  const files: Record<string, CoverageFile> = {}; let current: CoverageFile | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('SF:')) { const itemPath = normalized(line.slice(3).trim()); current = files[itemPath] ??= { path: itemPath, lines: {} }; }
    else if (current && line.startsWith('DA:')) { const [number, hits] = line.slice(3).split(','); if (Number.isInteger(Number(number))) current.lines[Number(number)] = Number(hits) || 0; }
    else if (line === 'end_of_record') current = undefined;
  }
  return evidence('lcov', files, options);
}

export function parseCobertura(text: string, options: EvidenceOptions): CoverageEvidence {
  const files: Record<string, CoverageFile> = {};
  for (const match of text.matchAll(/<class\b[^>]*\bfilename=["']([^"']+)["'][^>]*>([\s\S]*?)<\/class>/gi)) {
    const itemPath = normalized(match[1]), file = files[itemPath] ??= { path: itemPath, lines: {} };
    for (const line of match[2].matchAll(/<line\b[^>]*\bnumber=["'](\d+)["'][^>]*\bhits=["'](\d+)["'][^>]*\/?\s*>/gi)) file.lines[Number(line[1])] = Number(line[2]);
  }
  return evidence('cobertura', files, options);
}

export function parseGoCover(text: string, options: EvidenceOptions): CoverageEvidence {
  const files: Record<string, CoverageFile> = {};
  for (const line of text.split(/\r?\n/).slice(1)) {
    const match = line.match(/^(.+):(\d+)\.\d+,(\d+)\.\d+\s+\d+\s+(\d+)$/); if (!match) continue;
    const itemPath = normalized(match[1]), file = files[itemPath] ??= { path: itemPath, lines: {} }, hits = Number(match[4]);
    for (let number = Number(match[2]); number <= Number(match[3]); number++) file.lines[number] = Math.max(file.lines[number] ?? 0, hits);
  }
  return evidence('go', files, options);
}

function matchingFile(value: CoverageEvidence, filePath: string): CoverageFile | undefined {
  const wanted = normalized(filePath); if (value.files[wanted]) return value.files[wanted];
  const matches = Object.values(value.files).filter(file => file.path.endsWith(`/${wanted}`) || wanted.endsWith(`/${file.path}`));
  return matches.length === 1 ? matches[0] : undefined;
}
export function coverageForSpan(value: CoverageEvidence, filePath: string, start: number, end: number) {
  const file = matchingFile(value, filePath); if (!file) return null;
  const lines = Object.entries(file.lines).filter(([number]) => Number(number) >= start && Number(number) <= end);
  if (!lines.length) return null; const covered = lines.filter(([, hits]) => hits > 0).length;
  return { covered, executable: lines.length, fraction: covered / lines.length };
}

export function attachCoverage<T extends { nodes: any[] }>(index: T, value: CoverageEvidence, currentRevision?: string): T {
  const stale = !value.revisionVerified || Boolean(value.revision && currentRevision && value.revision !== currentRevision);
  return { ...index, nodes: index.nodes.map(node => {
    if (node.type !== 'function') return node; const matched = coverageForSpan(value, node.path, Number(node.line), Number(node.endLine ?? node.line));
    if (!matched) return { ...node, coverage: null, crap: null };
    const coverage = { ...matched, stale, revisionVerified: value.revisionVerified, source: value.source, format: value.format, revision: value.revision, collectedAt: value.collectedAt, formulaVersion: CRAP_FORMULA_VERSION };
    return { ...node, coverage, crap: stale ? null : crap(Number(node.complexity ?? 1), matched.fraction) };
  }) };
}

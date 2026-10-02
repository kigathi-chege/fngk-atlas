import path from 'node:path';
import { FileService } from '../files/file-service.js';
import { attachCoverage, parseCobertura, parseGoCover, parseLcov, type CoverageEvidence } from './coverage.js';

const artifacts = [
  { path: 'coverage/lcov.info', format: 'lcov' }, { path: 'lcov.info', format: 'lcov' },
  { path: 'coverage.xml', format: 'cobertura' }, { path: 'cobertura.xml', format: 'cobertura' },
  { path: 'cover.out', format: 'go' }, { path: 'coverage.out', format: 'go' },
] as const;

export class CoverageService {
  constructor(readonly files: FileService) {}
  async ingest<T extends { nodes: any[] }>(options: { contextId: string; repositoryPath: string; index: T; revision?: string; revisionVerified?: boolean }) {
    for (const candidate of artifacts) {
      const artifact = path.posix.join(options.repositoryPath, candidate.path);
      try {
        const opened = await this.files.read({ contextId: options.contextId, path: artifact }); if (!opened.text || opened.tooLarge) continue;
        const metadata = { source: artifact, revision: options.revision, revisionVerified: options.revisionVerified };
        let coverage: CoverageEvidence;
        if (candidate.format === 'lcov') coverage = parseLcov(opened.text, metadata);
        else if (candidate.format === 'cobertura') coverage = parseCobertura(opened.text, metadata);
        else coverage = parseGoCover(opened.text, metadata);
        return { artifact, evidence: coverage, index: attachCoverage(options.index, coverage, options.revision) };
      } catch {}
    }
    return { artifact: null, evidence: null, index: options.index };
  }
}

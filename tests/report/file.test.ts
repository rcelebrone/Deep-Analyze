import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { inferFormat, writeReportFile } from '../../src/report/file.js';
import type { CheckupResult } from '../../src/core/types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'depcheck-report-'));
});

function sampleResult(): CheckupResult {
  return {
    manifestsScanned: 1,
    dependencies: [
      {
        ecosystem: 'npm',
        name: 'vuln-pkg',
        manifestPath: '/fake/package.json',
        isDev: false,
        version: { resolvedCurrent: '1.0.0', latest: '2.0.0', majorsBehind: 1, minorsBehind: 0 },
        vulnerabilities: [{ id: 'GHSA-1', severity: 'HIGH', summary: 'bad' }],
        classification: 'critical',
      },
    ],
  };
}

describe('inferFormat', () => {
  it('infers markdown from a .md extension', () => {
    expect(inferFormat('report.md')).toBe('markdown');
  });

  it('defaults to json otherwise', () => {
    expect(inferFormat('report.txt')).toBe('json');
  });

  it('honors an explicit format over the extension', () => {
    expect(inferFormat('report.txt', 'markdown')).toBe('markdown');
  });
});

describe('writeReportFile', () => {
  it('writes valid JSON that round-trips the result', async () => {
    const path = join(dir, 'report.json');
    await writeReportFile(sampleResult(), path, 'json');
    const parsed = JSON.parse(await readFile(path, 'utf-8'));
    expect(parsed).toEqual(sampleResult());
  });

  it('writes markdown with a section per classification', async () => {
    const path = join(dir, 'report.md');
    await writeReportFile(sampleResult(), path, 'markdown');
    const content = await readFile(path, 'utf-8');
    expect(content).toContain('## Critical (1)');
    expect(content).toContain('vuln-pkg');
    expect(content).toContain('## Ok (0)');
  });
});

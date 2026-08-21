import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderTerminalReport } from '../../src/report/terminal.js';
import type { CheckupResult } from '../../src/core/types.js';

let logs: string[];

beforeEach(() => {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((msg: string) => {
    logs.push(msg);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
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
        version: { resolvedCurrent: '1.0.0', latest: '1.0.0', majorsBehind: 0, minorsBehind: 0 },
        vulnerabilities: [{ id: 'GHSA-1', severity: 'HIGH', summary: 'bad' }],
        classification: 'critical',
      },
      {
        ecosystem: 'npm',
        name: 'ok-pkg',
        manifestPath: '/fake/package.json',
        isDev: false,
        version: { resolvedCurrent: '1.0.0', latest: '1.0.0', majorsBehind: 0, minorsBehind: 0 },
        vulnerabilities: [],
        classification: 'ok',
      },
    ],
  };
}

describe('renderTerminalReport', () => {
  it('prints a summary line and a table for the critical group', () => {
    renderTerminalReport(sampleResult());
    const output = logs.join('\n');
    expect(output).toContain('1 critical');
    expect(output).toContain('vuln-pkg');
    expect(output).toContain('GHSA-1');
    expect(output).toContain('OK: 1 dependencies up to date');
  });
});

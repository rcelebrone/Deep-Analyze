import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProgram, type CliDeps } from '../src/cli.js';
import { CloneError } from '../src/core/clone.js';
import type { CheckupResult } from '../src/core/types.js';

function fakeDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    runCheckup: vi.fn().mockResolvedValue({ manifestsScanned: 1, dependencies: [] } satisfies CheckupResult),
    renderTerminalReport: vi.fn(),
    writeReportFile: vi.fn().mockResolvedValue(undefined),
    inferFormat: vi.fn().mockReturnValue('json'),
    createSpinner: () => ({ succeed: vi.fn(), fail: vi.fn(), warn: vi.fn() }),
    log: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('CLI', () => {
  it('runs the checkup and renders the terminal report', async () => {
    const deps = fakeDeps();
    await buildProgram(deps).parseAsync(['node', 'depcheck', 'https://example.com/repo.git']);

    expect(deps.runCheckup).toHaveBeenCalledWith(
      'https://example.com/repo.git',
      expect.objectContaining({ majorThreshold: 3, concurrency: 10 })
    );
    expect(deps.renderTerminalReport).toHaveBeenCalled();
  });

  it('writes a report file when --output is given', async () => {
    const deps = fakeDeps();
    await buildProgram(deps).parseAsync([
      'node',
      'depcheck',
      'https://example.com/repo.git',
      '--output',
      'report.json',
    ]);

    expect(deps.writeReportFile).toHaveBeenCalledWith(
      expect.objectContaining({ manifestsScanned: 1 }),
      'report.json',
      'json'
    );
  });

  it('passes through --major-threshold and --concurrency as numbers', async () => {
    const deps = fakeDeps();
    await buildProgram(deps).parseAsync([
      'node',
      'depcheck',
      'https://example.com/repo.git',
      '--major-threshold',
      '5',
      '--concurrency',
      '2',
    ]);

    expect(deps.runCheckup).toHaveBeenCalledWith(
      'https://example.com/repo.git',
      expect.objectContaining({ majorThreshold: 5, concurrency: 2 })
    );
  });

  it('sets exitCode to 1 and reports a friendly message on CloneError', async () => {
    const deps = fakeDeps({
      runCheckup: vi.fn().mockRejectedValue(new CloneError('https://example.com/repo.git', new Error('auth failed'))),
    });

    await buildProgram(deps).parseAsync(['node', 'depcheck', 'https://example.com/repo.git']);

    expect(process.exitCode).toBe(1);
    expect(deps.logError).toHaveBeenCalledWith(expect.stringContaining('Could not clone'));
  });

  it('skips rendering and warns when no manifests are found', async () => {
    const warn = vi.fn();
    const deps = fakeDeps({
      runCheckup: vi.fn().mockResolvedValue({ manifestsScanned: 0, dependencies: [] } satisfies CheckupResult),
      createSpinner: () => ({ succeed: vi.fn(), fail: vi.fn(), warn }),
    });

    await buildProgram(deps).parseAsync(['node', 'depcheck', 'https://example.com/repo.git']);

    expect(warn).toHaveBeenCalled();
    expect(deps.renderTerminalReport).not.toHaveBeenCalled();
  });
});

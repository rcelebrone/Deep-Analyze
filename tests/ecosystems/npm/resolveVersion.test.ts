import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveNpmVersion } from '../../../src/ecosystems/npm/resolveVersion.js';

function registryResponse(latest: string) {
  return { ok: true, status: 200, json: async () => ({ 'dist-tags': { latest } }) };
}

describe('resolveNpmVersion', () => {
  it('uses the lockfile version as current and computes majors/minors behind', async () => {
    const manifestPath = resolve('tests/fixtures/npm/package-lock/package.json');
    const fetchFn = vi.fn().mockResolvedValueOnce(registryResponse('2.1.0'));

    const result = await resolveNpmVersion(
      { ecosystem: 'npm', name: 'left-pad', declaredRange: '^1.3.0', isDev: false, manifestPath },
      { ecosystem: 'npm', manifestPath },
      fetchFn as unknown as typeof fetch
    );

    expect(result).toEqual({ resolvedCurrent: '1.3.0', latest: '2.1.0', majorsBehind: 1, minorsBehind: 0 });
    expect(fetchFn).toHaveBeenCalledWith('https://registry.npmjs.org/left-pad');
  });

  it('computes minorsBehind when majors match', async () => {
    const manifestPath = resolve('tests/fixtures/npm/package-lock/package.json');
    const fetchFn = vi.fn().mockResolvedValueOnce(registryResponse('1.5.0'));

    const result = await resolveNpmVersion(
      { ecosystem: 'npm', name: 'left-pad', declaredRange: '^1.3.0', isDev: false, manifestPath },
      { ecosystem: 'npm', manifestPath },
      fetchFn as unknown as typeof fetch
    );

    expect(result).toEqual({ resolvedCurrent: '1.3.0', latest: '1.5.0', majorsBehind: 0, minorsBehind: 2 });
  });

  it('falls back to the range minimum when there is no lockfile', async () => {
    const manifestPath = resolve('tests/fixtures/npm/no-lock/package.json');
    const fetchFn = vi.fn().mockResolvedValueOnce(registryResponse('1.3.0'));

    const result = await resolveNpmVersion(
      { ecosystem: 'npm', name: 'left-pad', declaredRange: '^1.3.0', isDev: false, manifestPath },
      { ecosystem: 'npm', manifestPath },
      fetchFn as unknown as typeof fetch
    );

    expect(result.resolvedCurrent).toBe('1.3.0');
  });

  it('builds a scoped-package registry URL correctly', async () => {
    const manifestPath = resolve('tests/fixtures/npm/no-lock/package.json');
    const fetchFn = vi.fn().mockResolvedValueOnce(registryResponse('1.0.0'));

    await resolveNpmVersion(
      { ecosystem: 'npm', name: '@types/node', declaredRange: '^1.0.0', isDev: false, manifestPath },
      { ecosystem: 'npm', manifestPath },
      fetchFn as unknown as typeof fetch
    );

    expect(fetchFn).toHaveBeenCalledWith('https://registry.npmjs.org/@types%2fnode');
  });
});

import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLockfileVersions } from '../../../src/ecosystems/npm/resolveLockfile.js';

describe('resolveLockfileVersions', () => {
  it('resolves from package-lock.json', async () => {
    const versions = await resolveLockfileVersions(resolve('tests/fixtures/npm/package-lock/package.json'));
    expect(versions.get('left-pad')).toBe('1.3.0');
  });

  it('resolves from pnpm-lock.yaml', async () => {
    const versions = await resolveLockfileVersions(resolve('tests/fixtures/npm/pnpm/package.json'));
    expect(versions.get('left-pad')).toBe('1.3.0');
  });

  it('resolves from yarn.lock', async () => {
    const versions = await resolveLockfileVersions(resolve('tests/fixtures/npm/yarn/package.json'));
    expect(versions.get('left-pad')).toBe('1.3.0');
  });

  it('returns an empty map when no lockfile is present', async () => {
    const versions = await resolveLockfileVersions(resolve('tests/fixtures/npm/no-lock/package.json'));
    expect(versions.size).toBe(0);
  });

  it('resolves scoped packages from yarn.lock', async () => {
    const versions = await resolveLockfileVersions(resolve('tests/fixtures/npm/yarn/package.json'));
    expect(versions.get('@babel/core')).toBe('7.23.0');
  });

  it('resolves peer-dependency-suffixed packages from pnpm-lock.yaml', async () => {
    const versions = await resolveLockfileVersions(resolve('tests/fixtures/npm/pnpm/package.json'));
    expect(versions.get('@testing-library/react')).toBe('13.4.0');
  });
});

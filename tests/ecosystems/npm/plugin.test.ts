import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { npmPlugin } from '../../../src/ecosystems/npm/plugin.js';

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'depcheck-npm-plugin-'));
  await writeFile(
    join(repoRoot, 'package.json'),
    JSON.stringify({ name: 'fixture', dependencies: { 'left-pad': '^1.3.0' } })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('npmPlugin', () => {
  it('discovers the manifest, parses it, and resolves versions end to end', async () => {
    const manifests = await npmPlugin.discover(repoRoot);
    expect(manifests).toHaveLength(1);

    const deps = await npmPlugin.parse(manifests[0]);
    expect(deps).toEqual([
      { ecosystem: 'npm', name: 'left-pad', declaredRange: '^1.3.0', isDev: false, manifestPath: manifests[0].manifestPath },
    ]);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ 'dist-tags': { latest: '1.3.0' } }) })
    );
    const version = await npmPlugin.resolveVersion(deps[0], manifests[0]);
    expect(version).toEqual({ resolvedCurrent: '1.3.0', latest: '1.3.0', majorsBehind: 0, minorsBehind: 0 });

    expect(npmPlugin.toOsvQuery(deps[0], version)).toEqual({
      package: { name: 'left-pad', ecosystem: 'npm' },
      version: '1.3.0',
    });
  });

  it('resolves a workspace-nested manifest against the ROOT lockfile, not the range minimum', async () => {
    const workspaceRoot = resolve('tests/fixtures/npm/workspace');
    const rootLockfilePath = resolve('tests/fixtures/npm/workspace/package-lock.json');
    const nestedManifestPath = resolve('tests/fixtures/npm/workspace/packages/app/package.json');

    const manifests = await npmPlugin.discover(workspaceRoot);
    const nestedManifest = manifests.find((m) => m.manifestPath === nestedManifestPath);
    expect(nestedManifest).toBeDefined();
    expect(nestedManifest?.lockfilePath).toBe(rootLockfilePath);

    const deps = await npmPlugin.parse(nestedManifest!);
    const lodashDep = deps.find((d) => d.name === 'lodash');
    expect(lodashDep).toBeDefined();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ 'dist-tags': { latest: '4.17.21' } }) })
    );
    const version = await npmPlugin.resolveVersion(lodashDep!, nestedManifest!);

    expect(version.resolvedCurrent).toBe('4.17.21');
    expect(version.resolvedCurrent).not.toBe('4.0.0');
  });
});

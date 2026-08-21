import { describe, expect, it, vi } from 'vitest';
import type { DependencyRef, EcosystemPlugin, ManifestRef, VersionInfo } from '../../src/core/types.js';

vi.mock('../../src/core/osv.js', () => ({
  queryOsvBatch: vi.fn(),
}));

const { queryOsvBatch } = await import('../../src/core/osv.js');
const { analyzeRepo } = await import('../../src/core/orchestrator.js');

function makeManifest(): ManifestRef {
  return { ecosystem: 'npm', manifestPath: '/fake/package.json' };
}

function makeDep(name: string): DependencyRef {
  return { ecosystem: 'npm', name, declaredRange: '^1.0.0', isDev: false, manifestPath: '/fake/package.json' };
}

function fakePlugin(overrides: Partial<EcosystemPlugin> = {}): EcosystemPlugin {
  return {
    id: 'npm',
    manifestFilenames: ['package.json'],
    discover: async () => [makeManifest()],
    parse: async () => [makeDep('good-pkg'), makeDep('broken-pkg')],
    resolveVersion: async (dep: DependencyRef): Promise<VersionInfo> => {
      if (dep.name === 'broken-pkg') throw new Error('registry down');
      return { resolvedCurrent: '1.0.0', latest: '1.0.0', majorsBehind: 0, minorsBehind: 0 };
    },
    toOsvQuery: (dep) => ({ package: { name: dep.name, ecosystem: 'npm' }, version: '1.0.0' }),
    ...overrides,
  };
}

describe('analyzeRepo', () => {
  it('resolves dependencies, isolates a failing lookup as unknown, and classifies the rest', async () => {
    vi.mocked(queryOsvBatch).mockResolvedValueOnce([[]]);

    const result = await analyzeRepo('/fake', {
      majorThreshold: 3,
      concurrency: 5,
      plugins: [fakePlugin()],
    });

    expect(result.manifestsScanned).toBe(1);
    expect(result.dependencies).toHaveLength(2);

    const good = result.dependencies.find((d) => d.name === 'good-pkg')!;
    expect(good.classification).toBe('ok');

    const broken = result.dependencies.find((d) => d.name === 'broken-pkg')!;
    expect(broken.classification).toBe('unknown');
    expect(broken.unknownReason).toContain('registry down');
  });

  it('returns an empty result with manifestsScanned 0 when no manifests are found', async () => {
    const plugin = fakePlugin({ discover: async () => [] });
    const result = await analyzeRepo('/fake', { majorThreshold: 3, concurrency: 5, plugins: [plugin] });
    expect(result).toEqual({ manifestsScanned: 0, dependencies: [] });
  });

  it('retries a resolveVersion failure once before marking it unknown', async () => {
    vi.mocked(queryOsvBatch).mockResolvedValueOnce([[]]);
    let calls = 0;
    const plugin = fakePlugin({
      parse: async () => [makeDep('flaky-pkg')],
      resolveVersion: async () => {
        calls += 1;
        if (calls === 1) throw new Error('transient');
        return { resolvedCurrent: '1.0.0', latest: '1.0.0', majorsBehind: 0, minorsBehind: 0 };
      },
    });

    const result = await analyzeRepo('/fake', { majorThreshold: 3, concurrency: 5, plugins: [plugin] });
    expect(calls).toBe(2);
    expect(result.dependencies[0].classification).toBe('ok');
  });

  it('marks resolved dependencies unknown (not "ok") when the OSV batch query fails outright', async () => {
    vi.mocked(queryOsvBatch).mockRejectedValueOnce(new Error('OSV unreachable'));
    const plugin = fakePlugin({ parse: async () => [makeDep('good-pkg')] });

    const result = await analyzeRepo('/fake', { majorThreshold: 3, concurrency: 5, plugins: [plugin] });

    const dep = result.dependencies.find((d) => d.name === 'good-pkg')!;
    expect(dep.classification).toBe('unknown');
    expect(dep.unknownReason).toContain('Vulnerability check failed');
    expect(dep.unknownReason).toContain('OSV unreachable');
  });
});

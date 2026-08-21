import { execa } from 'execa';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCheckup } from '../../src/core/orchestrator.js';
import { npmPlugin } from '../../src/ecosystems/npm/plugin.js';

let sourceRepoDir: string;

beforeEach(async () => {
  sourceRepoDir = await mkdtemp(join(tmpdir(), 'depcheck-integration-'));
  await execa('git', ['init'], { cwd: sourceRepoDir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: sourceRepoDir });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: sourceRepoDir });
  await writeFile(
    join(sourceRepoDir, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      dependencies: { 'vuln-pkg': '1.0.0', 'outdated-pkg': '1.0.0', 'current-pkg': '1.0.0' },
    })
  );
  await execa('git', ['add', '.'], { cwd: sourceRepoDir });
  await execa('git', ['commit', '-m', 'init'], { cwd: sourceRepoDir });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('runCheckup (integration)', () => {
  it('clones a real local repo and classifies dependencies using mocked HTTP', async () => {
    const registryResponses: Record<string, string> = {
      'vuln-pkg': '1.0.0',
      'outdated-pkg': '4.0.0',
      'current-pkg': '1.0.0',
    };

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://api.osv.dev/v1/querybatch') {
        const body = JSON.parse(init!.body as string) as { queries: { package: { name: string } }[] };
        const results = body.queries.map((q) =>
          q.package.name === 'vuln-pkg' ? { vulns: [{ id: 'GHSA-fake' }] } : {}
        );
        return { ok: true, json: async () => ({ results }) };
      }
      if (url === 'https://api.osv.dev/v1/vulns/GHSA-fake') {
        return { ok: true, json: async () => ({ id: 'GHSA-fake', summary: 'fake vuln', database_specific: { severity: 'HIGH' } }) };
      }
      const match = url.match(/registry\.npmjs\.org\/(.+)$/);
      const name = match![1];
      return { ok: true, json: async () => ({ 'dist-tags': { latest: registryResponses[name] } }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await runCheckup(sourceRepoDir, {
      majorThreshold: 3,
      concurrency: 5,
      plugins: [npmPlugin],
    });

    expect(result.manifestsScanned).toBe(1);
    const byName = new Map(result.dependencies.map((d) => [d.name, d]));
    expect(byName.get('vuln-pkg')?.classification).toBe('critical');
    expect(byName.get('outdated-pkg')?.classification).toBe('critical');
    expect(byName.get('current-pkg')?.classification).toBe('ok');
  });
});

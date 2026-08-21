import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { discoverManifests } from '../../src/core/discover.js';
import type { EcosystemPlugin } from '../../src/core/types.js';

const fakeNpmPlugin = { id: 'npm', manifestFilenames: ['package.json'] } as EcosystemPlugin;

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'depcheck-discover-'));
  await writeFile(join(repoRoot, 'package.json'), '{}');
  await mkdir(join(repoRoot, 'packages', 'app'), { recursive: true });
  await writeFile(join(repoRoot, 'packages', 'app', 'package.json'), '{}');
  await mkdir(join(repoRoot, 'node_modules', 'decoy'), { recursive: true });
  await writeFile(join(repoRoot, 'node_modules', 'decoy', 'package.json'), '{}');
  await mkdir(join(repoRoot, '.git'), { recursive: true });
  await writeFile(join(repoRoot, '.git', 'package.json'), '{}');
});

describe('discoverManifests', () => {
  it('finds manifests at any depth and skips ignored directories', async () => {
    const refs = await discoverManifests(repoRoot, [fakeNpmPlugin]);
    const paths = refs.map((r) => r.manifestPath).sort();
    expect(paths).toEqual(
      [join(repoRoot, 'package.json'), join(repoRoot, 'packages', 'app', 'package.json')].sort()
    );
    expect(refs.every((r) => r.ecosystem === 'npm')).toBe(true);
  });
});

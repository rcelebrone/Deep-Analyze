import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { discoverManifests } from '../../core/discover.js';
import type {
  DependencyRef,
  EcosystemPlugin,
  ManifestRef,
  OsvBatchQueryEntry,
  VersionInfo,
} from '../../core/types.js';
import { parseNpmManifest } from './parseManifest.js';
import { resolveNpmVersion } from './resolveVersion.js';

const LOCKFILE_PRIORITY = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'];

function findLockfileUpward(manifestDir: string, repoRoot: string): string | undefined {
  let dir = manifestDir;
  while (true) {
    for (const filename of LOCKFILE_PRIORITY) {
      const candidate = join(dir, filename);
      if (existsSync(candidate)) return candidate;
    }
    if (dir === repoRoot) return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined; // reached filesystem root without finding repoRoot (defensive)
    dir = parent;
  }
}

export const npmPlugin: EcosystemPlugin = {
  id: 'npm',
  manifestFilenames: ['package.json'],
  async discover(repoRoot: string): Promise<ManifestRef[]> {
    const manifests = await discoverManifests(repoRoot, [npmPlugin]);
    return manifests.map((manifest) => ({
      ...manifest,
      lockfilePath: findLockfileUpward(dirname(manifest.manifestPath), repoRoot),
    }));
  },
  parse: parseNpmManifest,
  resolveVersion: resolveNpmVersion,
  toOsvQuery(dep: DependencyRef, version: VersionInfo): OsvBatchQueryEntry {
    return { package: { name: dep.name, ecosystem: 'npm' }, version: version.resolvedCurrent };
  },
};

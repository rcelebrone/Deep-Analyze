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

export const npmPlugin: EcosystemPlugin = {
  id: 'npm',
  manifestFilenames: ['package.json'],
  async discover(repoRoot: string): Promise<ManifestRef[]> {
    return discoverManifests(repoRoot, [npmPlugin]);
  },
  parse: parseNpmManifest,
  resolveVersion: resolveNpmVersion,
  toOsvQuery(dep: DependencyRef, version: VersionInfo): OsvBatchQueryEntry {
    return { package: { name: dep.name, ecosystem: 'npm' }, version: version.resolvedCurrent };
  },
};

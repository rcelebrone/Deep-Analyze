import semver from 'semver';
import { z } from 'zod';
import type { DependencyRef, ManifestRef, VersionInfo } from '../../core/types.js';
import { resolveLockfileVersions } from './resolveLockfile.js';

type FetchFn = typeof fetch;

const NpmRegistrySchema = z.object({
  'dist-tags': z.object({ latest: z.string() }),
});

export async function resolveNpmVersion(
  dep: DependencyRef,
  manifest: ManifestRef,
  fetchFn: FetchFn = fetch
): Promise<VersionInfo> {
  const lockVersions = await resolveLockfileVersions(manifest.lockfilePath);
  const current = lockVersions.get(dep.name) ?? minVersionOf(dep.declaredRange);

  const res = await fetchFn(npmRegistryUrl(dep.name));
  if (!res.ok) {
    throw new Error(`npm registry lookup failed for ${dep.name}: ${res.status}`);
  }
  const data = NpmRegistrySchema.parse(await res.json());
  const latest = data['dist-tags'].latest;

  return {
    resolvedCurrent: current,
    latest,
    majorsBehind: Math.max(0, semver.major(latest) - semver.major(current)),
    minorsBehind: computeMinorsBehind(current, latest),
  };
}

function computeMinorsBehind(current: string, latest: string): number {
  if (semver.major(current) !== semver.major(latest)) return 0;
  return Math.max(0, semver.minor(latest) - semver.minor(current));
}

function minVersionOf(range: string): string {
  try {
    const version = semver.minVersion(range);
    if (!version) {
      throw new Error(`Cannot determine a version for declared range "${range}"`);
    }
    return version.version;
  } catch (err) {
    // If semver.minVersion throws (e.g., for workspace:*, file:..., git+...), wrap it
    if (err instanceof Error && err.message !== `Cannot determine a version for declared range "${range}"`) {
      throw new Error(`Cannot determine a version for declared range "${range}"`);
    }
    throw err;
  }
}

function npmRegistryUrl(name: string): string {
  if (name.startsWith('@')) {
    const [scope, pkg] = name.split('/');
    return `https://registry.npmjs.org/${scope}%2f${pkg}`;
  }
  return `https://registry.npmjs.org/${name}`;
}

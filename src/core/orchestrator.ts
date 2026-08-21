import pLimit from 'p-limit';
import { cleanupClone, cloneRepo } from './clone.js';
import { queryOsvBatch } from './osv.js';
import { classify } from './classify.js';
import type {
  CheckupResult,
  DependencyRef,
  DependencyReport,
  EcosystemPlugin,
  ManifestRef,
  VersionInfo,
  Vulnerability,
} from './types.js';

export interface OrchestratorOptions {
  token?: string;
  majorThreshold: number;
  concurrency: number;
  plugins: EcosystemPlugin[];
}

export async function runCheckup(repoUrl: string, options: OrchestratorOptions): Promise<CheckupResult> {
  const repoDir = await cloneRepo(repoUrl, { token: options.token });
  try {
    return await analyzeRepo(repoDir, options);
  } finally {
    await cleanupClone(repoDir);
  }
}

interface ResolvedDependency {
  dep: DependencyRef;
  plugin: EcosystemPlugin;
  manifest: ManifestRef;
  version?: VersionInfo;
  error?: string;
}

export async function analyzeRepo(repoDir: string, options: OrchestratorOptions): Promise<CheckupResult> {
  const limit = pLimit(options.concurrency);

  const manifestsByPlugin = await Promise.all(
    options.plugins.map(async (plugin) => ({ plugin, manifests: await plugin.discover(repoDir) }))
  );
  const allManifests = manifestsByPlugin.flatMap((m) => m.manifests);

  const toResolve: { plugin: EcosystemPlugin; manifest: ManifestRef; dep: DependencyRef }[] = [];
  for (const { plugin, manifests } of manifestsByPlugin) {
    for (const manifest of manifests) {
      const deps = await plugin.parse(manifest);
      for (const dep of deps) toResolve.push({ plugin, manifest, dep });
    }
  }

  const resolved: ResolvedDependency[] = await Promise.all(
    toResolve.map(({ plugin, manifest, dep }) =>
      limit(async (): Promise<ResolvedDependency> => {
        try {
          const version = await withRetry(() => plugin.resolveVersion(dep, manifest));
          return { dep, plugin, manifest, version };
        } catch (err) {
          return { dep, plugin, manifest, error: (err as Error).message };
        }
      })
    )
  );

  const withVersion = resolved.filter((r) => r.version !== undefined);
  const osvEntries = withVersion.map((r) => r.plugin.toOsvQuery(r.dep, r.version!));

  let vulnsByIndex: Vulnerability[][];
  try {
    vulnsByIndex = osvEntries.length > 0 ? await queryOsvBatch(osvEntries) : [];
  } catch {
    vulnsByIndex = withVersion.map(() => []);
  }

  let vulnCursor = 0;
  const dependencies: DependencyReport[] = resolved.map((r) => {
    const vulnerabilities = r.version !== undefined ? vulnsByIndex[vulnCursor++] ?? [] : [];
    const classification = classify({
      version: r.version,
      vulnerabilities,
      majorThreshold: options.majorThreshold,
      unknownReason: r.error,
    });
    return {
      ecosystem: r.dep.ecosystem,
      name: r.dep.name,
      manifestPath: r.dep.manifestPath,
      isDev: r.dep.isDev,
      version: r.version,
      vulnerabilities,
      classification,
      unknownReason: r.error,
    };
  });

  return { manifestsScanned: allManifests.length, dependencies };
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return await fn();
  }
}

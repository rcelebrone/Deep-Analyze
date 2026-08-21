import { readFile } from 'node:fs/promises';
import type { DependencyRef, ManifestRef } from '../../core/types.js';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function parseNpmManifest(manifest: ManifestRef): Promise<DependencyRef[]> {
  const raw = await readFile(manifest.manifestPath, 'utf-8');
  const pkg = JSON.parse(raw) as PackageJson;
  const deps: DependencyRef[] = [];

  for (const [name, range] of Object.entries(pkg.dependencies ?? {})) {
    deps.push({ ecosystem: 'npm', name, declaredRange: range, isDev: false, manifestPath: manifest.manifestPath });
  }
  for (const [name, range] of Object.entries(pkg.devDependencies ?? {})) {
    deps.push({ ecosystem: 'npm', name, declaredRange: range, isDev: true, manifestPath: manifest.manifestPath });
  }
  return deps;
}

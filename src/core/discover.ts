import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { EcosystemPlugin, ManifestRef } from './types.js';

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'vendor', '.venv', 'venv', '__pycache__']);

export async function discoverManifests(
  repoRoot: string,
  plugins: EcosystemPlugin[]
): Promise<ManifestRef[]> {
  const filenameToPlugin = new Map<string, EcosystemPlugin>();
  for (const plugin of plugins) {
    for (const filename of plugin.manifestFilenames) {
      filenameToPlugin.set(filename, plugin);
    }
  }
  const refs: ManifestRef[] = [];
  await walk(repoRoot, filenameToPlugin, refs);
  return refs;
}

async function walk(
  dir: string,
  filenameToPlugin: Map<string, EcosystemPlugin>,
  refs: ManifestRef[]
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      await walk(join(dir, entry.name), filenameToPlugin, refs);
      continue;
    }
    const plugin = filenameToPlugin.get(entry.name);
    if (plugin) {
      refs.push({ ecosystem: plugin.id, manifestPath: join(dir, entry.name) });
    }
  }
}

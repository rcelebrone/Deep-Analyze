import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export type LockfileVersions = Map<string, string>;

export async function resolveLockfileVersions(manifestPath: string): Promise<LockfileVersions> {
  const dir = dirname(manifestPath);

  const packageLockPath = join(dir, 'package-lock.json');
  if (existsSync(packageLockPath)) {
    return parsePackageLockJson(await readFile(packageLockPath, 'utf-8'));
  }

  const pnpmLockPath = join(dir, 'pnpm-lock.yaml');
  if (existsSync(pnpmLockPath)) {
    return parsePnpmLock(await readFile(pnpmLockPath, 'utf-8'));
  }

  const yarnLockPath = join(dir, 'yarn.lock');
  if (existsSync(yarnLockPath)) {
    return parseYarnLock(await readFile(yarnLockPath, 'utf-8'));
  }

  return new Map();
}

interface PackageLockJson {
  packages?: Record<string, { version?: string }>;
  dependencies?: Record<string, { version?: string }>;
}

export function parsePackageLockJson(raw: string): LockfileVersions {
  const data = JSON.parse(raw) as PackageLockJson;
  const versions: LockfileVersions = new Map();

  if (data.packages) {
    for (const [path, info] of Object.entries(data.packages)) {
      if (!path.startsWith('node_modules/') || !info.version) continue;
      versions.set(path.slice('node_modules/'.length), info.version);
    }
  } else if (data.dependencies) {
    for (const [name, info] of Object.entries(data.dependencies)) {
      if (info.version) versions.set(name, info.version);
    }
  }
  return versions;
}

export function parsePnpmLock(raw: string): LockfileVersions {
  const data = parseYaml(raw) as { packages?: Record<string, unknown> };
  const versions: LockfileVersions = new Map();
  for (const key of Object.keys(data.packages ?? {})) {
    const match = key.match(/^\/?(.+)@([^@/]+)$/);
    if (!match) continue;
    versions.set(match[1], match[2]);
  }
  return versions;
}

export function parseYarnLock(raw: string): LockfileVersions {
  const versions: LockfileVersions = new Map();
  const blocks = raw.split(/\n\n+/);
  for (const block of blocks) {
    const headerMatch = block.match(/^"?([^"@,\n]+)@/);
    const versionMatch = block.match(/^\s+version\s+"([^"]+)"/m);
    if (headerMatch && versionMatch) {
      versions.set(headerMatch[1], versionMatch[1]);
    }
  }
  return versions;
}

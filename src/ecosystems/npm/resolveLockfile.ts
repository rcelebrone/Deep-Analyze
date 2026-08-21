import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

export type LockfileVersions = Map<string, string>;

const lockfileCache = new Map<string, Promise<LockfileVersions>>();

export async function resolveLockfileVersions(lockfilePath: string | undefined): Promise<LockfileVersions> {
  if (!lockfilePath) return new Map();
  const cached = lockfileCache.get(lockfilePath);
  if (cached) return cached;
  const promise = readLockfile(lockfilePath);
  lockfileCache.set(lockfilePath, promise);
  return promise;
}

async function readLockfile(lockfilePath: string): Promise<LockfileVersions> {
  const raw = await readFile(lockfilePath, 'utf-8');
  if (lockfilePath.endsWith('package-lock.json')) return parsePackageLockJson(raw);
  if (lockfilePath.endsWith('pnpm-lock.yaml')) return parsePnpmLock(raw);
  if (lockfilePath.endsWith('yarn.lock')) return parseYarnLock(raw);
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
    const withoutPeers = key.split('(')[0];
    const match = withoutPeers.match(/^\/?(.+)@([^@/]+)$/);
    if (!match) continue;
    versions.set(match[1], match[2]);
  }
  return versions;
}

export function parseYarnLock(raw: string): LockfileVersions {
  const versions: LockfileVersions = new Map();
  const blocks = raw.split(/\n\n+/);
  for (const block of blocks) {
    const headerMatch = block.match(/^"?(@[^/]+\/[^@]+|[^"@,\n]+)@/);
    const versionMatch = block.match(/^\s+version\s+"([^"]+)"/m);
    if (headerMatch && versionMatch) {
      versions.set(headerMatch[1], versionMatch[1]);
    }
  }
  return versions;
}

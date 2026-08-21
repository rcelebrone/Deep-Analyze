# Dependency Checkup CLI — Core + npm Ecosystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fully working `depcheck` CLI that clones a git repo, checks up **npm** dependencies (vulnerabilities via OSV.dev, outdated majors/minors via the npm registry), classifies them, and reports the results in the terminal and optionally to a file — end to end, testable, and usable today.

**Architecture:** A core pipeline (clone → discover → parse → resolve versions → batch-query OSV → classify → render) driven by an `EcosystemPlugin` interface. This plan implements the core pipeline plus one plugin (npm). Later plans add Python, Go, and Packagist plugins by implementing the same interface — no changes to the core pipeline required.

**Tech Stack:** Node.js 22, TypeScript (ESM/NodeNext), `commander`, `execa`, `ora`, `chalk`, `cli-table3`, `p-limit`, `semver`, `yaml`, `zod`, `vitest`.

**Spec:** `docs/superpowers/specs/2026-08-21-dependency-checkup-cli-design.md`

## Global Constraints

- Node.js 22, TypeScript, package manager is npm (per spec's Tech Stack section).
- Shallow clone only: `git clone --depth=1`. Temp clone directory always removed (`finally` block).
- Private repo access relies on the environment's existing git credentials; `--token` is an explicit override injected into an `https://` clone URL.
- OSV.dev batch endpoint (`https://api.osv.dev/v1/querybatch`) and per-vuln detail endpoint (`https://api.osv.dev/v1/vulns/<id>`) — no auth.
- Classification: **critical** = vulnerability severity HIGH/CRITICAL OR `majorsBehind >= majorThreshold` (default 3, `--major-threshold`). **warning** = vulnerability LOW/MEDIUM OR `0 < majorsBehind < majorThreshold` OR `minorsBehind > 0`. **ok** = neither. **unknown** = a registry/OSV lookup failed after one retry.
- Exit codes: `0` on success (including "no manifests found"), `1` on repo access/clone failure. Vulnerabilities/outdated deps found do NOT change the exit code in v1.
- Bounded concurrency for all registry/OSV lookups via `p-limit`, default 10 (`--concurrency`). One retry on lookup failure before marking a dependency `unknown`.
- No network access in unit tests — all HTTP calls are dependency-injected or mocked; only the integration test may touch the filesystem (via a local git fixture), never the network.
- All relative imports use explicit `.js` extensions (required by NodeNext module resolution even though source files are `.ts`).

---

### Task 1: Project scaffolding and shared types

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/core/types.ts`

**Interfaces:**
- Produces: every shared type used by all later tasks — `EcosystemId`, `Severity`, `Vulnerability`, `ManifestRef`, `DependencyRef`, `VersionInfo`, `Classification`, `OsvBatchQueryEntry`, `DependencyReport`, `CheckupResult`, `EcosystemPlugin`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "depcheck",
  "version": "0.1.0",
  "description": "Dependency checkup CLI: vulnerabilities, outdated majors, and minor updates for a git repository",
  "type": "module",
  "bin": {
    "depcheck": "./dist/cli.js"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx src/cli.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "chalk": "^5.3.0",
    "cli-table3": "^0.6.5",
    "commander": "^12.1.0",
    "execa": "^9.3.0",
    "ora": "^8.1.0",
    "p-limit": "^6.1.0",
    "semver": "^7.6.3",
    "yaml": "^2.5.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install`
Expected: completes with no errors, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 15000,
  },
});
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
*.log
```

- [ ] **Step 6: Create `src/core/types.ts`**

```ts
export type EcosystemId = 'npm' | 'pypi' | 'go' | 'packagist';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface Vulnerability {
  id: string;
  severity: Severity;
  summary: string;
}

export interface ManifestRef {
  ecosystem: EcosystemId;
  manifestPath: string;
}

export interface DependencyRef {
  ecosystem: EcosystemId;
  name: string;
  declaredRange: string;
  isDev: boolean;
  manifestPath: string;
}

export interface VersionInfo {
  resolvedCurrent: string;
  latest: string;
  majorsBehind: number;
  minorsBehind: number;
}

export type Classification = 'critical' | 'warning' | 'ok' | 'unknown';

export interface OsvBatchQueryEntry {
  package: { name: string; ecosystem: string };
  version: string;
}

export interface DependencyReport {
  ecosystem: EcosystemId;
  name: string;
  manifestPath: string;
  isDev: boolean;
  version?: VersionInfo;
  vulnerabilities: Vulnerability[];
  classification: Classification;
  unknownReason?: string;
}

export interface CheckupResult {
  manifestsScanned: number;
  dependencies: DependencyReport[];
}

export interface EcosystemPlugin {
  id: EcosystemId;
  manifestFilenames: string[];
  discover(repoRoot: string): Promise<ManifestRef[]>;
  parse(manifest: ManifestRef): Promise<DependencyRef[]>;
  resolveVersion(dep: DependencyRef, manifest: ManifestRef): Promise<VersionInfo>;
  toOsvQuery(dep: DependencyRef, version: VersionInfo): OsvBatchQueryEntry;
}
```

- [ ] **Step 7: Verify the project compiles**

Run: `npm run typecheck`
Expected: exits with no errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/core/types.ts
git commit -m "chore: scaffold project and add shared core types"
```

---

### Task 2: Classification logic

**Files:**
- Create: `src/core/classify.ts`
- Test: `tests/core/classify.test.ts`

**Interfaces:**
- Consumes: `Severity`, `Vulnerability`, `VersionInfo`, `Classification` from `src/core/types.ts`.
- Produces: `classify(input: ClassifyInput): Classification` and `ClassifyInput`, used by the orchestrator (Task 10).

- [ ] **Step 1: Write the failing test**

Create `tests/core/classify.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classify } from '../../src/core/classify.js';

const noVersion = undefined;

describe('classify', () => {
  it('returns unknown when a lookup failed', () => {
    const result = classify({ vulnerabilities: [], majorThreshold: 3, unknownReason: 'registry timeout' });
    expect(result).toBe('unknown');
  });

  it('returns critical for a HIGH severity vulnerability', () => {
    const result = classify({
      vulnerabilities: [{ id: 'GHSA-1', severity: 'HIGH', summary: 'x' }],
      majorThreshold: 3,
    });
    expect(result).toBe('critical');
  });

  it('returns critical for a CRITICAL severity vulnerability', () => {
    const result = classify({
      vulnerabilities: [{ id: 'GHSA-1', severity: 'CRITICAL', summary: 'x' }],
      majorThreshold: 3,
    });
    expect(result).toBe('critical');
  });

  it('returns critical when majorsBehind meets the threshold', () => {
    const result = classify({
      version: { resolvedCurrent: '1.0.0', latest: '4.0.0', majorsBehind: 3, minorsBehind: 0 },
      vulnerabilities: [],
      majorThreshold: 3,
    });
    expect(result).toBe('critical');
  });

  it('returns warning for a LOW/MEDIUM severity vulnerability', () => {
    const result = classify({
      vulnerabilities: [{ id: 'GHSA-1', severity: 'LOW', summary: 'x' }],
      majorThreshold: 3,
    });
    expect(result).toBe('warning');
  });

  it('returns warning when majorsBehind is below threshold but above zero', () => {
    const result = classify({
      version: { resolvedCurrent: '1.0.0', latest: '2.0.0', majorsBehind: 1, minorsBehind: 0 },
      vulnerabilities: [],
      majorThreshold: 3,
    });
    expect(result).toBe('warning');
  });

  it('returns warning when only minorsBehind is nonzero', () => {
    const result = classify({
      version: { resolvedCurrent: '1.0.0', latest: '1.4.0', majorsBehind: 0, minorsBehind: 4 },
      vulnerabilities: [],
      majorThreshold: 3,
    });
    expect(result).toBe('warning');
  });

  it('returns ok when up to date with no vulnerabilities', () => {
    const result = classify({
      version: { resolvedCurrent: '1.0.0', latest: '1.0.0', majorsBehind: 0, minorsBehind: 0 },
      vulnerabilities: [],
      majorThreshold: 3,
    });
    expect(result).toBe('ok');
  });

  it('returns ok when no version info and no vulnerabilities', () => {
    const result = classify({ version: noVersion, vulnerabilities: [], majorThreshold: 3 });
    expect(result).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/classify.test.ts`
Expected: FAIL — cannot find module `src/core/classify.js` (or similar module-not-found error).

- [ ] **Step 3: Write the implementation**

Create `src/core/classify.ts`:

```ts
import type { Classification, Severity, Vulnerability, VersionInfo } from './types.js';

export interface ClassifyInput {
  version?: VersionInfo;
  vulnerabilities: Vulnerability[];
  majorThreshold: number;
  unknownReason?: string;
}

const HIGH_SEVERITIES: Severity[] = ['CRITICAL', 'HIGH'];

export function classify(input: ClassifyInput): Classification {
  if (input.unknownReason) return 'unknown';

  const hasHighVuln = input.vulnerabilities.some((v) => HIGH_SEVERITIES.includes(v.severity));
  if (hasHighVuln) return 'critical';

  const majorsBehind = input.version?.majorsBehind ?? 0;
  if (majorsBehind >= input.majorThreshold) return 'critical';

  const hasLowOrMediumVuln = input.vulnerabilities.length > 0;
  const minorsBehind = input.version?.minorsBehind ?? 0;
  if (hasLowOrMediumVuln || (majorsBehind > 0 && majorsBehind < input.majorThreshold) || minorsBehind > 0) {
    return 'warning';
  }

  return 'ok';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/classify.test.ts`
Expected: PASS, all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/core/classify.ts tests/core/classify.test.ts
git commit -m "feat: add dependency classification logic"
```

---

### Task 3: OSV batch vulnerability client

**Files:**
- Create: `src/core/osv.ts`
- Test: `tests/core/osv.test.ts`

**Interfaces:**
- Consumes: `OsvBatchQueryEntry`, `Vulnerability`, `Severity` from `src/core/types.ts`.
- Produces: `queryOsvBatch(entries: OsvBatchQueryEntry[], fetchFn?: typeof fetch): Promise<Vulnerability[][]>` — result array is positionally aligned with `entries`. Used by the orchestrator (Task 10).

- [ ] **Step 1: Write the failing test**

Create `tests/core/osv.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { queryOsvBatch } from '../../src/core/osv.js';

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, statusText: 'error', json: async () => body };
}

describe('queryOsvBatch', () => {
  it('returns an empty array without calling fetch when entries is empty', async () => {
    const fetchFn = vi.fn();
    const result = await queryOsvBatch([], fetchFn as unknown as typeof fetch);
    expect(result).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps batch results back to positional vulnerability details', async () => {
    const entries = [
      { package: { name: 'left-pad', ecosystem: 'npm' }, version: '1.0.0' },
      { package: { name: 'safe-pkg', ecosystem: 'npm' }, version: '2.0.0' },
    ];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ vulns: [{ id: 'GHSA-1' }] }, {}] })
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: 'GHSA-1', summary: 'bad', database_specific: { severity: 'HIGH' } })
      );

    const result = await queryOsvBatch(entries, fetchFn as unknown as typeof fetch);

    expect(result).toEqual([
      [{ id: 'GHSA-1', severity: 'HIGH', summary: 'bad' }],
      [],
    ]);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.osv.dev/v1/querybatch',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchFn).toHaveBeenCalledWith('https://api.osv.dev/v1/vulns/GHSA-1');
  });

  it('defaults severity to MEDIUM when the detail omits it', async () => {
    const entries = [{ package: { name: 'left-pad', ecosystem: 'npm' }, version: '1.0.0' }];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ vulns: [{ id: 'GHSA-2' }] }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'GHSA-2' }));

    const result = await queryOsvBatch(entries, fetchFn as unknown as typeof fetch);
    expect(result).toEqual([[{ id: 'GHSA-2', severity: 'MEDIUM', summary: '' }]]);
  });

  it('throws when the batch request fails', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse({}, false));
    await expect(
      queryOsvBatch([{ package: { name: 'x', ecosystem: 'npm' }, version: '1.0.0' }], fetchFn as unknown as typeof fetch)
    ).rejects.toThrow('OSV batch query failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/osv.test.ts`
Expected: FAIL — cannot find module `src/core/osv.js`.

- [ ] **Step 3: Write the implementation**

Create `src/core/osv.ts`:

```ts
import { z } from 'zod';
import type { OsvBatchQueryEntry, Severity, Vulnerability } from './types.js';

const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_URL = 'https://api.osv.dev/v1/vulns';

type FetchFn = typeof fetch;

const BatchResponseSchema = z.object({
  results: z.array(z.object({ vulns: z.array(z.object({ id: z.string() })).optional() })),
});

const VulnDetailSchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
  database_specific: z.object({ severity: z.string().optional() }).optional(),
});

type VulnDetail = z.infer<typeof VulnDetailSchema>;

function severityFromDetail(detail: VulnDetail): Severity {
  const dbSeverity = detail.database_specific?.severity?.toUpperCase();
  if (dbSeverity === 'CRITICAL' || dbSeverity === 'HIGH' || dbSeverity === 'MEDIUM' || dbSeverity === 'LOW') {
    return dbSeverity;
  }
  return 'MEDIUM';
}

export async function queryOsvBatch(
  entries: OsvBatchQueryEntry[],
  fetchFn: FetchFn = fetch
): Promise<Vulnerability[][]> {
  if (entries.length === 0) return [];

  const res = await fetchFn(OSV_BATCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries: entries }),
  });
  if (!res.ok) {
    throw new Error(`OSV batch query failed: ${res.status} ${res.statusText}`);
  }
  const body = BatchResponseSchema.parse(await res.json());
  const idsPerEntry = body.results.map((r) => r.vulns?.map((v) => v.id) ?? []);

  const allIds = Array.from(new Set(idsPerEntry.flat()));
  const detailsById = new Map<string, Vulnerability>();
  for (const id of allIds) {
    const detail = await fetchVulnDetail(id, fetchFn);
    detailsById.set(id, { id, severity: severityFromDetail(detail), summary: detail.summary ?? '' });
  }

  return idsPerEntry.map((ids) =>
    ids.map((id) => detailsById.get(id)).filter((v): v is Vulnerability => v !== undefined)
  );
}

async function fetchVulnDetail(id: string, fetchFn: FetchFn): Promise<VulnDetail> {
  const res = await fetchFn(`${OSV_VULN_URL}/${id}`);
  if (!res.ok) {
    throw new Error(`OSV vuln detail fetch failed for ${id}: ${res.status}`);
  }
  return VulnDetailSchema.parse(await res.json());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/osv.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/core/osv.ts tests/core/osv.test.ts
git commit -m "feat: add OSV.dev batch vulnerability client"
```

---

### Task 4: Git clone wrapper

**Files:**
- Create: `src/core/clone.ts`
- Test: `tests/core/clone.test.ts`

**Interfaces:**
- Produces: `cloneRepo(url: string, options?: { token?: string }): Promise<string>` (returns the temp directory path), `cleanupClone(dir: string): Promise<void>`, `class CloneError extends Error` with `url` and `cause` fields. Used by the orchestrator (Task 10) and the CLI (Task 13).

- [ ] **Step 1: Write the failing test**

Create `tests/core/clone.test.ts`:

```ts
import { execa } from 'execa';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanupClone, CloneError, cloneRepo } from '../../src/core/clone.js';

let sourceRepoDir: string;
let clonedDir: string | undefined;

beforeEach(async () => {
  sourceRepoDir = await mkdtemp(join(tmpdir(), 'depcheck-source-'));
  await execa('git', ['init'], { cwd: sourceRepoDir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: sourceRepoDir });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: sourceRepoDir });
  await writeFile(join(sourceRepoDir, 'package.json'), '{"name":"fixture"}');
  await execa('git', ['add', '.'], { cwd: sourceRepoDir });
  await execa('git', ['commit', '-m', 'init'], { cwd: sourceRepoDir });
});

afterEach(async () => {
  if (clonedDir) await cleanupClone(clonedDir);
  clonedDir = undefined;
});

describe('cloneRepo', () => {
  it('clones a repository into a temp directory', async () => {
    clonedDir = await cloneRepo(sourceRepoDir);
    const content = await readFile(join(clonedDir, 'package.json'), 'utf-8');
    expect(content).toBe('{"name":"fixture"}');
  });

  it('throws a CloneError and removes the temp dir when the clone fails', async () => {
    const bogusPath = join(tmpdir(), 'depcheck-does-not-exist-' + Math.random().toString(36).slice(2));
    await expect(cloneRepo(bogusPath)).rejects.toBeInstanceOf(CloneError);
  });
});

describe('cleanupClone', () => {
  it('removes the given directory', async () => {
    const dir = await cloneRepo(sourceRepoDir);
    await cleanupClone(dir);
    await expect(stat(dir)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/clone.test.ts`
Expected: FAIL — cannot find module `src/core/clone.js`.

- [ ] **Step 3: Write the implementation**

Create `src/core/clone.ts`:

```ts
import { execa } from 'execa';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface CloneOptions {
  token?: string;
}

export class CloneError extends Error {
  constructor(public readonly url: string, public readonly cause: Error) {
    super(`Failed to clone ${url}: ${cause.message}`);
  }
}

export async function cloneRepo(url: string, options: CloneOptions = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'depcheck-'));
  const cloneUrl = injectToken(url, options.token);
  try {
    await execa('git', ['clone', '--depth=1', cloneUrl, dir]);
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw new CloneError(url, err as Error);
  }
  return dir;
}

export async function cleanupClone(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

function injectToken(url: string, token?: string): string {
  if (!token || !url.startsWith('https://')) return url;
  const withoutScheme = url.slice('https://'.length);
  return `https://${token}@${withoutScheme}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/clone.test.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/core/clone.ts tests/core/clone.test.ts
git commit -m "feat: add shallow git clone wrapper with cleanup"
```

---

### Task 5: Manifest discovery walker

**Files:**
- Create: `src/core/discover.ts`
- Test: `tests/core/discover.test.ts`

**Interfaces:**
- Consumes: `EcosystemPlugin`, `ManifestRef` from `src/core/types.ts`.
- Produces: `discoverManifests(repoRoot: string, plugins: EcosystemPlugin[]): Promise<ManifestRef[]>`. Used by ecosystem plugins (Task 9) and indirectly by the orchestrator.

- [ ] **Step 1: Write the failing test**

Create `tests/core/discover.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/discover.test.ts`
Expected: FAIL — cannot find module `src/core/discover.js`.

- [ ] **Step 3: Write the implementation**

Create `src/core/discover.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/discover.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/discover.ts tests/core/discover.test.ts
git commit -m "feat: add manifest discovery walker"
```

---

### Task 6: npm plugin — parse `package.json`

**Files:**
- Create: `src/ecosystems/npm/parseManifest.ts`
- Create: `tests/fixtures/npm/basic/package.json`
- Test: `tests/ecosystems/npm/parseManifest.test.ts`

**Interfaces:**
- Consumes: `DependencyRef`, `ManifestRef` from `src/core/types.ts`.
- Produces: `parseNpmManifest(manifest: ManifestRef): Promise<DependencyRef[]>`. Used by the npm plugin assembly (Task 9).

- [ ] **Step 1: Create the fixture**

Create `tests/fixtures/npm/basic/package.json`:

```json
{
  "name": "fixture",
  "version": "1.0.0",
  "dependencies": {
    "left-pad": "^1.3.0"
  },
  "devDependencies": {
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/ecosystems/npm/parseManifest.test.ts`:

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNpmManifest } from '../../../src/ecosystems/npm/parseManifest.js';

describe('parseNpmManifest', () => {
  it('parses dependencies and devDependencies with correct flags', async () => {
    const manifestPath = resolve('tests/fixtures/npm/basic/package.json');
    const deps = await parseNpmManifest({ ecosystem: 'npm', manifestPath });

    expect(deps).toEqual(
      expect.arrayContaining([
        { ecosystem: 'npm', name: 'left-pad', declaredRange: '^1.3.0', isDev: false, manifestPath },
        { ecosystem: 'npm', name: 'vitest', declaredRange: '^2.0.0', isDev: true, manifestPath },
      ])
    );
    expect(deps).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/ecosystems/npm/parseManifest.test.ts`
Expected: FAIL — cannot find module `src/ecosystems/npm/parseManifest.js`.

- [ ] **Step 4: Write the implementation**

Create `src/ecosystems/npm/parseManifest.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/ecosystems/npm/parseManifest.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ecosystems/npm/parseManifest.ts tests/ecosystems/npm/parseManifest.test.ts tests/fixtures/npm/basic
git commit -m "feat(npm): parse package.json dependencies"
```

---

### Task 7: npm plugin — lockfile resolution

**Files:**
- Create: `src/ecosystems/npm/resolveLockfile.ts`
- Create: `tests/fixtures/npm/package-lock/package.json`, `tests/fixtures/npm/package-lock/package-lock.json`
- Create: `tests/fixtures/npm/pnpm/package.json`, `tests/fixtures/npm/pnpm/pnpm-lock.yaml`
- Create: `tests/fixtures/npm/yarn/package.json`, `tests/fixtures/npm/yarn/yarn.lock`
- Create: `tests/fixtures/npm/no-lock/package.json`
- Test: `tests/ecosystems/npm/resolveLockfile.test.ts`

**Interfaces:**
- Produces: `resolveLockfileVersions(manifestPath: string): Promise<Map<string, string>>` (`LockfileVersions`). Used by `resolveVersion.ts` (Task 8).

- [ ] **Step 1: Create the fixtures**

Create `tests/fixtures/npm/package-lock/package.json`:

```json
{ "name": "fixture", "version": "1.0.0", "dependencies": { "left-pad": "^1.3.0" } }
```

Create `tests/fixtures/npm/package-lock/package-lock.json`:

```json
{
  "name": "fixture",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": { "name": "fixture", "version": "1.0.0", "dependencies": { "left-pad": "^1.3.0" } },
    "node_modules/left-pad": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz"
    }
  }
}
```

Create `tests/fixtures/npm/pnpm/package.json`:

```json
{ "name": "fixture", "version": "1.0.0", "dependencies": { "left-pad": "^1.3.0" } }
```

Create `tests/fixtures/npm/pnpm/pnpm-lock.yaml`:

```yaml
lockfileVersion: '6.0'
packages:
  /left-pad@1.3.0:
    resolution: { integrity: sha512-fake }
```

Create `tests/fixtures/npm/yarn/package.json`:

```json
{ "name": "fixture", "version": "1.0.0", "dependencies": { "left-pad": "^1.3.0" } }
```

Create `tests/fixtures/npm/yarn/yarn.lock`:

```
# THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY.
# yarn lockfile v1


left-pad@^1.3.0:
  version "1.3.0"
  resolved "https://registry.yarnpkg.com/left-pad/-/left-pad-1.3.0.tgz"
  integrity sha512-fake
```

Create `tests/fixtures/npm/no-lock/package.json`:

```json
{ "name": "fixture", "version": "1.0.0", "dependencies": { "left-pad": "^1.3.0" } }
```

- [ ] **Step 2: Write the failing test**

Create `tests/ecosystems/npm/resolveLockfile.test.ts`:

```ts
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLockfileVersions } from '../../../src/ecosystems/npm/resolveLockfile.js';

describe('resolveLockfileVersions', () => {
  it('resolves from package-lock.json', async () => {
    const versions = await resolveLockfileVersions(resolve('tests/fixtures/npm/package-lock/package.json'));
    expect(versions.get('left-pad')).toBe('1.3.0');
  });

  it('resolves from pnpm-lock.yaml', async () => {
    const versions = await resolveLockfileVersions(resolve('tests/fixtures/npm/pnpm/package.json'));
    expect(versions.get('left-pad')).toBe('1.3.0');
  });

  it('resolves from yarn.lock', async () => {
    const versions = await resolveLockfileVersions(resolve('tests/fixtures/npm/yarn/package.json'));
    expect(versions.get('left-pad')).toBe('1.3.0');
  });

  it('returns an empty map when no lockfile is present', async () => {
    const versions = await resolveLockfileVersions(resolve('tests/fixtures/npm/no-lock/package.json'));
    expect(versions.size).toBe(0);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/ecosystems/npm/resolveLockfile.test.ts`
Expected: FAIL — cannot find module `src/ecosystems/npm/resolveLockfile.js`.

- [ ] **Step 4: Write the implementation**

Create `src/ecosystems/npm/resolveLockfile.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/ecosystems/npm/resolveLockfile.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/ecosystems/npm/resolveLockfile.ts tests/ecosystems/npm/resolveLockfile.test.ts tests/fixtures/npm/package-lock tests/fixtures/npm/pnpm tests/fixtures/npm/yarn tests/fixtures/npm/no-lock
git commit -m "feat(npm): resolve exact versions from package-lock.json, pnpm-lock.yaml, and yarn.lock"
```

---

### Task 8: npm plugin — registry latest-version lookup

**Files:**
- Create: `src/ecosystems/npm/resolveVersion.ts`
- Test: `tests/ecosystems/npm/resolveVersion.test.ts`

**Interfaces:**
- Consumes: `DependencyRef`, `ManifestRef`, `VersionInfo` from `src/core/types.ts`; `resolveLockfileVersions` from Task 7.
- Produces: `resolveNpmVersion(dep: DependencyRef, manifest: ManifestRef, fetchFn?: typeof fetch): Promise<VersionInfo>`. Used by the npm plugin assembly (Task 9).

- [ ] **Step 1: Write the failing test**

Create `tests/ecosystems/npm/resolveVersion.test.ts`:

```ts
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveNpmVersion } from '../../../src/ecosystems/npm/resolveVersion.js';

function registryResponse(latest: string) {
  return { ok: true, status: 200, json: async () => ({ 'dist-tags': { latest } }) };
}

describe('resolveNpmVersion', () => {
  it('uses the lockfile version as current and computes majors/minors behind', async () => {
    const manifestPath = resolve('tests/fixtures/npm/package-lock/package.json');
    const fetchFn = vi.fn().mockResolvedValueOnce(registryResponse('2.1.0'));

    const result = await resolveNpmVersion(
      { ecosystem: 'npm', name: 'left-pad', declaredRange: '^1.3.0', isDev: false, manifestPath },
      { ecosystem: 'npm', manifestPath },
      fetchFn as unknown as typeof fetch
    );

    expect(result).toEqual({ resolvedCurrent: '1.3.0', latest: '2.1.0', majorsBehind: 1, minorsBehind: 0 });
    expect(fetchFn).toHaveBeenCalledWith('https://registry.npmjs.org/left-pad');
  });

  it('computes minorsBehind when majors match', async () => {
    const manifestPath = resolve('tests/fixtures/npm/package-lock/package.json');
    const fetchFn = vi.fn().mockResolvedValueOnce(registryResponse('1.5.0'));

    const result = await resolveNpmVersion(
      { ecosystem: 'npm', name: 'left-pad', declaredRange: '^1.3.0', isDev: false, manifestPath },
      { ecosystem: 'npm', manifestPath },
      fetchFn as unknown as typeof fetch
    );

    expect(result).toEqual({ resolvedCurrent: '1.3.0', latest: '1.5.0', majorsBehind: 0, minorsBehind: 2 });
  });

  it('falls back to the range minimum when there is no lockfile', async () => {
    const manifestPath = resolve('tests/fixtures/npm/no-lock/package.json');
    const fetchFn = vi.fn().mockResolvedValueOnce(registryResponse('1.3.0'));

    const result = await resolveNpmVersion(
      { ecosystem: 'npm', name: 'left-pad', declaredRange: '^1.3.0', isDev: false, manifestPath },
      { ecosystem: 'npm', manifestPath },
      fetchFn as unknown as typeof fetch
    );

    expect(result.resolvedCurrent).toBe('1.3.0');
  });

  it('builds a scoped-package registry URL correctly', async () => {
    const manifestPath = resolve('tests/fixtures/npm/no-lock/package.json');
    const fetchFn = vi.fn().mockResolvedValueOnce(registryResponse('1.0.0'));

    await resolveNpmVersion(
      { ecosystem: 'npm', name: '@types/node', declaredRange: '^1.0.0', isDev: false, manifestPath },
      { ecosystem: 'npm', manifestPath },
      fetchFn as unknown as typeof fetch
    );

    expect(fetchFn).toHaveBeenCalledWith('https://registry.npmjs.org/@types%2fnode');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ecosystems/npm/resolveVersion.test.ts`
Expected: FAIL — cannot find module `src/ecosystems/npm/resolveVersion.js`.

- [ ] **Step 3: Write the implementation**

Create `src/ecosystems/npm/resolveVersion.ts`:

```ts
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
  const lockVersions = await resolveLockfileVersions(manifest.manifestPath);
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
  const version = semver.minVersion(range);
  return version ? version.version : range.replace(/^[^\d]*/, '');
}

function npmRegistryUrl(name: string): string {
  if (name.startsWith('@')) {
    const [scope, pkg] = name.split('/');
    return `https://registry.npmjs.org/${scope}%2f${pkg}`;
  }
  return `https://registry.npmjs.org/${name}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ecosystems/npm/resolveVersion.test.ts`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/ecosystems/npm/resolveVersion.ts tests/ecosystems/npm/resolveVersion.test.ts
git commit -m "feat(npm): resolve latest version and majors/minors behind from the npm registry"
```

---

### Task 9: npm plugin assembly and ecosystem registry

**Files:**
- Create: `src/ecosystems/npm/plugin.ts`
- Create: `src/ecosystems/registry.ts`
- Test: `tests/ecosystems/npm/plugin.test.ts`

**Interfaces:**
- Consumes: `discoverManifests` (Task 5), `parseNpmManifest` (Task 6), `resolveNpmVersion` (Task 8), `EcosystemPlugin` type (Task 1).
- Produces: `npmPlugin: EcosystemPlugin` and `ecosystemPlugins: EcosystemPlugin[]`. Used by the orchestrator (Task 10) and CLI (Task 13).

- [ ] **Step 1: Write the failing test**

Create `tests/ecosystems/npm/plugin.test.ts`:

```ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { npmPlugin } from '../../../src/ecosystems/npm/plugin.js';

let repoRoot: string;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'depcheck-npm-plugin-'));
  await writeFile(
    join(repoRoot, 'package.json'),
    JSON.stringify({ name: 'fixture', dependencies: { 'left-pad': '^1.3.0' } })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('npmPlugin', () => {
  it('discovers the manifest, parses it, and resolves versions end to end', async () => {
    const manifests = await npmPlugin.discover(repoRoot);
    expect(manifests).toHaveLength(1);

    const deps = await npmPlugin.parse(manifests[0]);
    expect(deps).toEqual([
      { ecosystem: 'npm', name: 'left-pad', declaredRange: '^1.3.0', isDev: false, manifestPath: manifests[0].manifestPath },
    ]);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ 'dist-tags': { latest: '1.3.0' } }) })
    );
    const version = await npmPlugin.resolveVersion(deps[0], manifests[0]);
    expect(version).toEqual({ resolvedCurrent: '1.3.0', latest: '1.3.0', majorsBehind: 0, minorsBehind: 0 });

    expect(npmPlugin.toOsvQuery(deps[0], version)).toEqual({
      package: { name: 'left-pad', ecosystem: 'npm' },
      version: '1.3.0',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ecosystems/npm/plugin.test.ts`
Expected: FAIL — cannot find module `src/ecosystems/npm/plugin.js`.

- [ ] **Step 3: Write the implementation**

Create `src/ecosystems/npm/plugin.ts`:

```ts
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
```

Create `src/ecosystems/registry.ts`:

```ts
import type { EcosystemPlugin } from '../core/types.js';
import { npmPlugin } from './npm/plugin.js';

export const ecosystemPlugins: EcosystemPlugin[] = [npmPlugin];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ecosystems/npm/plugin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ecosystems/npm/plugin.ts src/ecosystems/registry.ts tests/ecosystems/npm/plugin.test.ts
git commit -m "feat(npm): assemble the npm EcosystemPlugin and register it"
```

---

### Task 10: Orchestrator pipeline

**Files:**
- Create: `src/core/orchestrator.ts`
- Test: `tests/core/orchestrator.test.ts`

**Interfaces:**
- Consumes: `cloneRepo`/`cleanupClone` (Task 4), `queryOsvBatch` (Task 3), `classify` (Task 2), `EcosystemPlugin`/`CheckupResult`/`DependencyReport` (Task 1).
- Produces: `analyzeRepo(repoDir: string, options: OrchestratorOptions): Promise<CheckupResult>` and `runCheckup(repoUrl: string, options: OrchestratorOptions): Promise<CheckupResult>`, where `OrchestratorOptions = { token?: string; majorThreshold: number; concurrency: number; plugins: EcosystemPlugin[] }`. Used by the CLI (Task 13) and the integration test (Task 14).

- [ ] **Step 1: Write the failing test**

Create `tests/core/orchestrator.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { DependencyRef, EcosystemPlugin, ManifestRef, VersionInfo } from '../../src/core/types.js';

vi.mock('../../src/core/osv.js', () => ({
  queryOsvBatch: vi.fn(),
}));

const { queryOsvBatch } = await import('../../src/core/osv.js');
const { analyzeRepo } = await import('../../src/core/orchestrator.js');

function makeManifest(): ManifestRef {
  return { ecosystem: 'npm', manifestPath: '/fake/package.json' };
}

function makeDep(name: string): DependencyRef {
  return { ecosystem: 'npm', name, declaredRange: '^1.0.0', isDev: false, manifestPath: '/fake/package.json' };
}

function fakePlugin(overrides: Partial<EcosystemPlugin> = {}): EcosystemPlugin {
  return {
    id: 'npm',
    manifestFilenames: ['package.json'],
    discover: async () => [makeManifest()],
    parse: async () => [makeDep('good-pkg'), makeDep('broken-pkg')],
    resolveVersion: async (dep: DependencyRef): Promise<VersionInfo> => {
      if (dep.name === 'broken-pkg') throw new Error('registry down');
      return { resolvedCurrent: '1.0.0', latest: '1.0.0', majorsBehind: 0, minorsBehind: 0 };
    },
    toOsvQuery: (dep) => ({ package: { name: dep.name, ecosystem: 'npm' }, version: '1.0.0' }),
    ...overrides,
  };
}

describe('analyzeRepo', () => {
  it('resolves dependencies, isolates a failing lookup as unknown, and classifies the rest', async () => {
    vi.mocked(queryOsvBatch).mockResolvedValueOnce([[]]);

    const result = await analyzeRepo('/fake', {
      majorThreshold: 3,
      concurrency: 5,
      plugins: [fakePlugin()],
    });

    expect(result.manifestsScanned).toBe(1);
    expect(result.dependencies).toHaveLength(2);

    const good = result.dependencies.find((d) => d.name === 'good-pkg')!;
    expect(good.classification).toBe('ok');

    const broken = result.dependencies.find((d) => d.name === 'broken-pkg')!;
    expect(broken.classification).toBe('unknown');
    expect(broken.unknownReason).toContain('registry down');
  });

  it('returns an empty result with manifestsScanned 0 when no manifests are found', async () => {
    const plugin = fakePlugin({ discover: async () => [] });
    const result = await analyzeRepo('/fake', { majorThreshold: 3, concurrency: 5, plugins: [plugin] });
    expect(result).toEqual({ manifestsScanned: 0, dependencies: [] });
  });

  it('retries a resolveVersion failure once before marking it unknown', async () => {
    vi.mocked(queryOsvBatch).mockResolvedValueOnce([[]]);
    let calls = 0;
    const plugin = fakePlugin({
      parse: async () => [makeDep('flaky-pkg')],
      resolveVersion: async () => {
        calls += 1;
        if (calls === 1) throw new Error('transient');
        return { resolvedCurrent: '1.0.0', latest: '1.0.0', majorsBehind: 0, minorsBehind: 0 };
      },
    });

    const result = await analyzeRepo('/fake', { majorThreshold: 3, concurrency: 5, plugins: [plugin] });
    expect(calls).toBe(2);
    expect(result.dependencies[0].classification).toBe('ok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/orchestrator.test.ts`
Expected: FAIL — cannot find module `src/core/orchestrator.js`.

- [ ] **Step 3: Write the implementation**

Create `src/core/orchestrator.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/orchestrator.test.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/core/orchestrator.ts tests/core/orchestrator.test.ts
git commit -m "feat: add orchestrator pipeline wiring clone, resolve, OSV, and classify"
```

---

### Task 11: Terminal report renderer

**Files:**
- Create: `src/report/terminal.ts`
- Test: `tests/report/terminal.test.ts`

**Interfaces:**
- Consumes: `CheckupResult`, `DependencyReport` from `src/core/types.ts`.
- Produces: `renderTerminalReport(result: CheckupResult): void`. Used by the CLI (Task 13).

- [ ] **Step 1: Write the failing test**

Create `tests/report/terminal.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderTerminalReport } from '../../src/report/terminal.js';
import type { CheckupResult } from '../../src/core/types.js';

let logs: string[];

beforeEach(() => {
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((msg: string) => {
    logs.push(msg);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function sampleResult(): CheckupResult {
  return {
    manifestsScanned: 1,
    dependencies: [
      {
        ecosystem: 'npm',
        name: 'vuln-pkg',
        manifestPath: '/fake/package.json',
        isDev: false,
        version: { resolvedCurrent: '1.0.0', latest: '1.0.0', majorsBehind: 0, minorsBehind: 0 },
        vulnerabilities: [{ id: 'GHSA-1', severity: 'HIGH', summary: 'bad' }],
        classification: 'critical',
      },
      {
        ecosystem: 'npm',
        name: 'ok-pkg',
        manifestPath: '/fake/package.json',
        isDev: false,
        version: { resolvedCurrent: '1.0.0', latest: '1.0.0', majorsBehind: 0, minorsBehind: 0 },
        vulnerabilities: [],
        classification: 'ok',
      },
    ],
  };
}

describe('renderTerminalReport', () => {
  it('prints a summary line and a table for the critical group', () => {
    renderTerminalReport(sampleResult());
    const output = logs.join('\n');
    expect(output).toContain('1 critical');
    expect(output).toContain('vuln-pkg');
    expect(output).toContain('GHSA-1');
    expect(output).toContain('OK: 1 dependencies up to date');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/report/terminal.test.ts`
Expected: FAIL — cannot find module `src/report/terminal.js`.

- [ ] **Step 3: Write the implementation**

Create `src/report/terminal.ts`:

```ts
import chalk from 'chalk';
import Table from 'cli-table3';
import type { CheckupResult, DependencyReport } from '../core/types.js';

interface Groups {
  critical: DependencyReport[];
  warning: DependencyReport[];
  ok: DependencyReport[];
  unknown: DependencyReport[];
}

export function renderTerminalReport(result: CheckupResult): void {
  const groups = groupByClassification(result.dependencies);
  console.log(summaryLine(result, groups));
  printGroup('Critical', groups.critical, chalk.red);
  printGroup('Warning', groups.warning, chalk.yellow);
  printGroup('Unknown', groups.unknown, chalk.gray);
  if (groups.ok.length > 0) {
    console.log(chalk.green(`OK: ${groups.ok.length} dependencies up to date`));
  }
}

function groupByClassification(deps: DependencyReport[]): Groups {
  return {
    critical: deps.filter((d) => d.classification === 'critical'),
    warning: deps.filter((d) => d.classification === 'warning'),
    ok: deps.filter((d) => d.classification === 'ok'),
    unknown: deps.filter((d) => d.classification === 'unknown'),
  };
}

function summaryLine(result: CheckupResult, groups: Groups): string {
  return chalk.bold(
    `Scanned ${result.manifestsScanned} manifest(s) — ` +
      `${chalk.red(groups.critical.length + ' critical')}, ` +
      `${chalk.yellow(groups.warning.length + ' warning')}, ` +
      `${groups.ok.length} ok, ` +
      `${chalk.gray(groups.unknown.length + ' unknown')}`
  );
}

function printGroup(title: string, deps: DependencyReport[], color: (s: string) => string): void {
  if (deps.length === 0) return;
  console.log('\n' + color(chalk.bold(title)));
  const table = new Table({ head: ['Ecosystem', 'Package', 'Current', 'Latest', 'Majors behind', 'Vulnerabilities'] });
  for (const dep of deps) {
    table.push([
      dep.ecosystem,
      dep.name,
      dep.version?.resolvedCurrent ?? '?',
      dep.version?.latest ?? '?',
      String(dep.version?.majorsBehind ?? '?'),
      dep.vulnerabilities.map((v) => `${v.id} (${v.severity})`).join(', ') || dep.unknownReason || '-',
    ]);
  }
  console.log(table.toString());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/report/terminal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/report/terminal.ts tests/report/terminal.test.ts
git commit -m "feat: add colored terminal report renderer"
```

---

### Task 12: File report renderer (JSON + Markdown)

**Files:**
- Create: `src/report/file.ts`
- Test: `tests/report/file.test.ts`

**Interfaces:**
- Consumes: `CheckupResult`, `DependencyReport` from `src/core/types.ts`.
- Produces: `type ReportFormat = 'json' | 'markdown'`, `inferFormat(path: string, explicit?: ReportFormat): ReportFormat`, `writeReportFile(result: CheckupResult, path: string, format: ReportFormat): Promise<void>`. Used by the CLI (Task 13).

- [ ] **Step 1: Write the failing test**

Create `tests/report/file.test.ts`:

```ts
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { inferFormat, writeReportFile } from '../../src/report/file.js';
import type { CheckupResult } from '../../src/core/types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'depcheck-report-'));
});

function sampleResult(): CheckupResult {
  return {
    manifestsScanned: 1,
    dependencies: [
      {
        ecosystem: 'npm',
        name: 'vuln-pkg',
        manifestPath: '/fake/package.json',
        isDev: false,
        version: { resolvedCurrent: '1.0.0', latest: '2.0.0', majorsBehind: 1, minorsBehind: 0 },
        vulnerabilities: [{ id: 'GHSA-1', severity: 'HIGH', summary: 'bad' }],
        classification: 'critical',
      },
    ],
  };
}

describe('inferFormat', () => {
  it('infers markdown from a .md extension', () => {
    expect(inferFormat('report.md')).toBe('markdown');
  });

  it('defaults to json otherwise', () => {
    expect(inferFormat('report.txt')).toBe('json');
  });

  it('honors an explicit format over the extension', () => {
    expect(inferFormat('report.txt', 'markdown')).toBe('markdown');
  });
});

describe('writeReportFile', () => {
  it('writes valid JSON that round-trips the result', async () => {
    const path = join(dir, 'report.json');
    await writeReportFile(sampleResult(), path, 'json');
    const parsed = JSON.parse(await readFile(path, 'utf-8'));
    expect(parsed).toEqual(sampleResult());
  });

  it('writes markdown with a section per classification', async () => {
    const path = join(dir, 'report.md');
    await writeReportFile(sampleResult(), path, 'markdown');
    const content = await readFile(path, 'utf-8');
    expect(content).toContain('## Critical (1)');
    expect(content).toContain('vuln-pkg');
    expect(content).toContain('## Ok (0)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/report/file.test.ts`
Expected: FAIL — cannot find module `src/report/file.js`.

- [ ] **Step 3: Write the implementation**

Create `src/report/file.ts`:

```ts
import { writeFile } from 'node:fs/promises';
import type { CheckupResult, DependencyReport } from '../core/types.js';

export type ReportFormat = 'json' | 'markdown';

export function inferFormat(path: string, explicit?: ReportFormat): ReportFormat {
  if (explicit) return explicit;
  return path.endsWith('.md') ? 'markdown' : 'json';
}

export async function writeReportFile(result: CheckupResult, path: string, format: ReportFormat): Promise<void> {
  const content = format === 'json' ? toJson(result) : toMarkdown(result);
  await writeFile(path, content, 'utf-8');
}

function toJson(result: CheckupResult): string {
  return JSON.stringify(result, null, 2);
}

const SECTIONS = ['critical', 'warning', 'unknown', 'ok'] as const;

function toMarkdown(result: CheckupResult): string {
  const lines: string[] = ['# Dependency Checkup Report', '', `Manifests scanned: ${result.manifestsScanned}`, ''];
  for (const label of SECTIONS) {
    const deps = result.dependencies.filter((d) => d.classification === label);
    lines.push(`## ${capitalize(label)} (${deps.length})`, '');
    if (deps.length === 0) {
      lines.push('_none_', '');
      continue;
    }
    lines.push('| Ecosystem | Package | Current | Latest | Vulnerabilities |', '|---|---|---|---|---|');
    for (const dep of deps) {
      lines.push(
        `| ${dep.ecosystem} | ${dep.name} | ${dep.version?.resolvedCurrent ?? '?'} | ${dep.version?.latest ?? '?'} | ${formatVulns(dep)} |`
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

function formatVulns(dep: DependencyReport): string {
  if (dep.vulnerabilities.length === 0) return dep.unknownReason ?? '-';
  return dep.vulnerabilities.map((v) => `${v.id} (${v.severity})`).join(', ');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/report/file.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/report/file.ts tests/report/file.test.ts
git commit -m "feat: add JSON and Markdown file report renderer"
```

---

### Task 13: CLI entrypoint

**Files:**
- Create: `src/cli.ts`
- Test: `tests/cli.test.ts`

**Interfaces:**
- Consumes: `runCheckup` (Task 10), `ecosystemPlugins` (Task 9), `renderTerminalReport` (Task 11), `inferFormat`/`writeReportFile` (Task 12), `CloneError` (Task 4).
- Produces: `buildProgram(deps?: CliDeps): Command` (exported for testing) and a `#!/usr/bin/env node` executable entrypoint.

- [ ] **Step 1: Write the failing test**

Create `tests/cli.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProgram, type CliDeps } from '../src/cli.js';
import { CloneError } from '../src/core/clone.js';
import type { CheckupResult } from '../src/core/types.js';

function fakeDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    runCheckup: vi.fn().mockResolvedValue({ manifestsScanned: 1, dependencies: [] } satisfies CheckupResult),
    renderTerminalReport: vi.fn(),
    writeReportFile: vi.fn().mockResolvedValue(undefined),
    inferFormat: vi.fn().mockReturnValue('json'),
    createSpinner: () => ({ succeed: vi.fn(), fail: vi.fn(), warn: vi.fn() }),
    log: vi.fn(),
    logError: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('CLI', () => {
  it('runs the checkup and renders the terminal report', async () => {
    const deps = fakeDeps();
    await buildProgram(deps).parseAsync(['node', 'depcheck', 'https://example.com/repo.git']);

    expect(deps.runCheckup).toHaveBeenCalledWith(
      'https://example.com/repo.git',
      expect.objectContaining({ majorThreshold: 3, concurrency: 10 })
    );
    expect(deps.renderTerminalReport).toHaveBeenCalled();
  });

  it('writes a report file when --output is given', async () => {
    const deps = fakeDeps();
    await buildProgram(deps).parseAsync([
      'node',
      'depcheck',
      'https://example.com/repo.git',
      '--output',
      'report.json',
    ]);

    expect(deps.writeReportFile).toHaveBeenCalledWith(
      expect.objectContaining({ manifestsScanned: 1 }),
      'report.json',
      'json'
    );
  });

  it('passes through --major-threshold and --concurrency as numbers', async () => {
    const deps = fakeDeps();
    await buildProgram(deps).parseAsync([
      'node',
      'depcheck',
      'https://example.com/repo.git',
      '--major-threshold',
      '5',
      '--concurrency',
      '2',
    ]);

    expect(deps.runCheckup).toHaveBeenCalledWith(
      'https://example.com/repo.git',
      expect.objectContaining({ majorThreshold: 5, concurrency: 2 })
    );
  });

  it('sets exitCode to 1 and reports a friendly message on CloneError', async () => {
    const deps = fakeDeps({
      runCheckup: vi.fn().mockRejectedValue(new CloneError('https://example.com/repo.git', new Error('auth failed'))),
    });

    await buildProgram(deps).parseAsync(['node', 'depcheck', 'https://example.com/repo.git']);

    expect(process.exitCode).toBe(1);
    expect(deps.logError).toHaveBeenCalledWith(expect.stringContaining('Could not clone'));
  });

  it('skips rendering and warns when no manifests are found', async () => {
    const warn = vi.fn();
    const deps = fakeDeps({
      runCheckup: vi.fn().mockResolvedValue({ manifestsScanned: 0, dependencies: [] } satisfies CheckupResult),
      createSpinner: () => ({ succeed: vi.fn(), fail: vi.fn(), warn }),
    });

    await buildProgram(deps).parseAsync(['node', 'depcheck', 'https://example.com/repo.git']);

    expect(warn).toHaveBeenCalled();
    expect(deps.renderTerminalReport).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli.test.ts`
Expected: FAIL — cannot find module `src/cli.js`.

- [ ] **Step 3: Write the implementation**

Create `src/cli.ts`:

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import ora from 'ora';
import { CloneError } from './core/clone.js';
import { runCheckup } from './core/orchestrator.js';
import type { CheckupResult } from './core/types.js';
import { ecosystemPlugins } from './ecosystems/registry.js';
import { inferFormat, writeReportFile, type ReportFormat } from './report/file.js';
import { renderTerminalReport } from './report/terminal.js';

export interface Spinner {
  succeed(text: string): void;
  fail(text: string): void;
  warn(text: string): void;
}

export interface CliDeps {
  runCheckup: typeof runCheckup;
  renderTerminalReport: (result: CheckupResult) => void;
  writeReportFile: typeof writeReportFile;
  inferFormat: typeof inferFormat;
  createSpinner: (text: string) => Spinner;
  log: (msg: string) => void;
  logError: (msg: string) => void;
}

export const defaultDeps: CliDeps = {
  runCheckup,
  renderTerminalReport,
  writeReportFile,
  inferFormat,
  createSpinner: (text: string) => ora(text).start(),
  log: (msg: string) => console.log(msg),
  logError: (msg: string) => console.error(msg),
};

export function buildProgram(deps: CliDeps = defaultDeps): Command {
  const program = new Command();

  program
    .name('depcheck')
    .description('Dependency checkup for a git repository')
    .argument('<repo-url>', 'Repository URL (public or private)')
    .option('--token <token>', 'Explicit auth token for private repo access')
    .option('--major-threshold <n>', 'Majors-behind count considered critical', '3')
    .option('--output <path>', 'Write report to file')
    .option('--format <format>', 'Report file format: json|markdown')
    .option('--concurrency <n>', 'Max concurrent registry/OSV requests', '10')
    .action(async (repoUrl: string, opts) => {
      const spinner = deps.createSpinner('Cloning repository...');
      try {
        const result = await deps.runCheckup(repoUrl, {
          token: opts.token,
          majorThreshold: Number(opts.majorThreshold),
          concurrency: Number(opts.concurrency),
          plugins: ecosystemPlugins,
        });

        if (result.manifestsScanned === 0) {
          spinner.warn('No supported manifests found in this repository.');
          return;
        }

        spinner.succeed(`Scanned ${result.manifestsScanned} manifest(s)`);
        deps.renderTerminalReport(result);

        if (opts.output) {
          const format = deps.inferFormat(opts.output, opts.format as ReportFormat | undefined);
          await deps.writeReportFile(result, opts.output, format);
          deps.log(`\nReport written to ${opts.output}`);
        }
      } catch (err) {
        spinner.fail('Checkup failed');
        if (err instanceof CloneError) {
          deps.logError(
            `Could not clone ${err.url}. If this is a private repository, make sure your git credentials ` +
              `(SSH key or credential helper) are configured, or pass --token.`
          );
        } else {
          deps.logError((err as Error).message);
        }
        process.exitCode = 1;
      }
    });

  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildProgram().parseAsync(process.argv);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Build and smoke-test the compiled CLI**

Run: `npm run build && node dist/cli.js --help`
Expected: build succeeds; `--help` prints usage including `--token`, `--major-threshold`, `--output`, `--format`, `--concurrency`.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts tests/cli.test.ts
git commit -m "feat: add CLI entrypoint wiring the full pipeline"
```

---

### Task 14: End-to-end integration test

**Files:**
- Test: `tests/integration/orchestrator.test.ts`

**Interfaces:**
- Consumes: `runCheckup` (Task 10), `npmPlugin` (Task 9) — exercises the real pipeline against a real local git repository with only HTTP mocked.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/orchestrator.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails or is not yet meaningful**

Run: `npx vitest run tests/integration/orchestrator.test.ts`
Expected: at this point all prior tasks are implemented, so this should already PASS. If it fails, treat the failure as a real bug in the wiring between tasks and fix the relevant source file (not the test) before proceeding.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS — every test file from Tasks 2–14 is green.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/orchestrator.test.ts
git commit -m "test: add end-to-end integration test for the npm checkup pipeline"
```

---

### Task 15: README and packaging sanity check

**Files:**
- Create: `README.md`

**Interfaces:** None — documentation and packaging verification only.

- [ ] **Step 1: Write `README.md`**

```markdown
# depcheck

Dependency checkup CLI: point it at a git repository and get a report of
outdated and vulnerable dependencies.

## Install

```bash
npm install -g depcheck
```

Or run without installing:

```bash
npx depcheck <repo-url>
```

## Usage

```bash
depcheck https://github.com/some-org/some-repo.git
```

### Options

- `--token <token>` — explicit auth token for a private repo, used if your
  environment's git credentials aren't already configured for it.
- `--major-threshold <n>` — number of majors behind that counts as critical
  (default: `3`).
- `--output <path>` — also write the report to a file.
- `--format <json|markdown>` — format for `--output` (default: inferred
  from the file extension, falling back to `json`).
- `--concurrency <n>` — max concurrent registry/OSV requests (default: `10`).

## Supported ecosystems

- npm (`package.json`, with `package-lock.json`, `pnpm-lock.yaml`, or
  `yarn.lock`)

Python, Go, and PHP support are planned as follow-up increments.

## Private repositories

`depcheck` clones with your machine's existing git credentials (SSH agent
or credential helper) — no extra setup needed if `git clone` already works
for the repo. Pass `--token` to override.
```

- [ ] **Step 2: Verify the package is ready to publish**

Run: `npm run build && npm pack --dry-run`
Expected: the dry-run file list includes `dist/cli.js` and `README.md`, with no unexpected files.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with install and usage instructions"
```

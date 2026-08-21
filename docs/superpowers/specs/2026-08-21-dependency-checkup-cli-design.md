# Dependency Checkup CLI — Design Spec

Date: 2026-08-21

## Purpose

A CLI tool that, given a git repository URL (public or private), clones it,
discovers dependency manifests across supported ecosystems, and produces a
"checkup" report: which dependencies have known vulnerabilities, which are
critically outdated, and which have routine minor/patch updates available.
Optimized for developer experience — fast feedback, clear terminal output,
sensible defaults, minimal configuration required to get a first result.

## Scope (v1)

Supported ecosystems:

- **Node.js** — `package.json` (+ `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`)
- **Python** — `requirements.txt`, `pyproject.toml`/`poetry.lock`, `Pipfile`/`Pipfile.lock`
- **Go** — `go.mod` / `go.sum`
- **PHP** — `composer.json` / `composer.lock`

Monorepos are supported: the tool discovers all manifests in the repo tree,
not just at the root.

Out of scope for v1 (explicitly deferred, not designed for extensibility
beyond the plugin interface below): Java/Maven, Ruby, generic EOL tracking
for arbitrary libraries (see "Classification rules").

## CLI Interface

```
depcheck check <repo-url> [options]

Options:
  --token <token>          Explicit auth token, appended to clone URL when the
                            environment's git credentials aren't sufficient
  --major-threshold <n>    Majors-behind count that qualifies as "critical"
                            (default: 3)
  --output <path>          Write report to file in addition to terminal
  --format <json|markdown> Format for --output (default: inferred from
                            extension, falls back to json)
  --concurrency <n>        Max concurrent registry/OSV requests (default: 10)
```

Exit codes: `0` success (including "no manifests found"), `1` on repo
access/clone failure or invalid input. Vulnerabilities/outdated deps found do
NOT change the exit code in v1 (this is a reporting tool, not a CI gate) —
can be revisited later if wanted as a `--fail-on critical` flag.

## Architecture

### Pipeline (orchestrator)

`src/core/orchestrator.ts` runs, in order:

1. **Clone**: shallow clone (`git clone --depth=1 <url> <tmpdir>`) into a
   directory under `os.tmpdir()`. Relies on the environment's existing git
   credential configuration (SSH agent, credential helper, `.netrc`, etc.)
   for private repos. If `--token` is given, it's injected into an
   `https://` clone URL (`https://<token>@host/...`) as an override/fallback.
   The temp directory is removed in a `finally` block and on `SIGINT`/`SIGTERM`.
2. **Discover**: walk the cloned tree (skipping `.git`, `node_modules`,
   `vendor`, `.venv` and similar dependency-output directories) collecting
   every file matching a registered ecosystem plugin's `manifestFilenames`.
3. **Parse**: each matching manifest is handed to its plugin's `parse()`,
   producing a flat list of `DependencyRef` (name, version range as declared,
   dev/prod flag, source manifest path).
4. **Resolve current version**: if a lockfile is present alongside the
   manifest, the plugin resolves the exact installed version from it.
   Otherwise, it falls back to the minimum version satisfying the declared
   range. This resolved version is what gets checked against OSV (vulnerability
   databases are keyed by exact version).
5. **Resolve latest**: each plugin queries its ecosystem registry for the
   package's available versions and computes `latest`, `majorsBehind`,
   `minorsBehind` relative to the resolved current version.
6. **Vulnerability check**: all resolved dependencies across all ecosystems
   are batched into OSV.dev's `POST /v1/querybatch` (no auth required, batches
   of up to 1000 `{package: {name, ecosystem}, version}` entries). Results are
   matched back to each dependency.
7. **Classify**: see rules below.
8. **Render**: terminal report always; file report if `--output` given.

Steps 4–6 run with bounded concurrency (`p-limit`, default 10) and per-item
error isolation — a failed lookup marks that dependency `unknown` with a
reason, and does not abort the run. Failed lookups are retried once with
backoff before being marked unknown.

### Ecosystem plugin interface

```ts
interface ManifestRef {
  ecosystem: EcosystemId;
  manifestPath: string;     // absolute path in the cloned repo
  lockfilePath?: string;    // absolute path, if found alongside
}

interface DependencyRef {
  ecosystem: EcosystemId;
  name: string;
  declaredRange: string;    // as written in the manifest
  isDev: boolean;
  manifestPath: string;
}

interface VersionInfo {
  resolvedCurrent: string;  // exact version used for vuln/version comparison
  latest: string;
  majorsBehind: number;
  minorsBehind: number;
}

interface OsvBatchQueryEntry {
  package: { name: string; ecosystem: string };
  version: string;
}

interface EcosystemPlugin {
  id: EcosystemId; // 'npm' | 'pypi' | 'go' | 'packagist'
  manifestFilenames: string[];
  discover(repoRoot: string): Promise<ManifestRef[]>;
  parse(manifest: ManifestRef): Promise<DependencyRef[]>;
  resolveVersion(dep: DependencyRef, manifest: ManifestRef): Promise<VersionInfo>;
  toOsvQuery(dep: DependencyRef, version: VersionInfo): OsvBatchQueryEntry;
}
```

Each plugin lives in `src/ecosystems/<id>/` and is independently unit
tested. Plugins are registered in a central registry
(`src/ecosystems/registry.ts`) that the orchestrator iterates over —
adding a new ecosystem later means adding one plugin file plus one
registry entry, no orchestrator changes.

### Registries used per ecosystem (no auth required)

| Ecosystem | Latest-version source | Vulnerability source |
|---|---|---|
| npm | `https://registry.npmjs.org/<pkg>` | OSV.dev (`ecosystem: "npm"`) |
| PyPI | `https://pypi.org/pypi/<pkg>/json` | OSV.dev (`ecosystem: "PyPI"`) |
| Go | `https://proxy.golang.org/<module>/@v/list` + `@latest` | OSV.dev (`ecosystem: "Go"`) |
| Packagist | `https://repo.packagist.org/p2/<vendor>/<pkg>.json` | OSV.dev (`ecosystem: "Packagist"`) |

## Classification rules

- **Critical**: has a vulnerability with OSV/CVSS severity `HIGH` or
  `CRITICAL`, OR `majorsBehind >= majorThreshold` (default 3).
- **Warning**: has a vulnerability with severity `LOW`/`MEDIUM`, OR
  `0 < majorsBehind < majorThreshold`, OR `minorsBehind > 0`.
- **OK**: none of the above (up to date, no known vulnerability).
- **Unknown**: registry or OSV lookup failed after retry; reported
  separately, does not count toward critical/warning/ok totals.

Generic EOL tracking for arbitrary libraries is explicitly out of scope —
there's no reliable universal data source at that granularity. "Critical"
is fully covered by the vulnerability + majors-behind rule above.

## Output

### Terminal (default, always shown)

- Summary line at the top: counts of critical / warning / ok / unknown,
  and number of manifests scanned.
- Grouped tables (via `cli-table3`, colored via `chalk`):
  Critical (red) → Warning (yellow) → Unknown (gray). OK dependencies are
  summarized as a count, not listed individually (keeps output scannable —
  full list available via `--output`).
- Each row: ecosystem, package name, current → latest, majors/minors
  behind, vulnerability IDs (if any) with severity.
- `ora` spinners during clone/discovery/resolution phases.

### File (`--output <path>`)

- `--format json`: full structured report (every dependency, every field,
  including OK ones) — for CI/tooling consumption.
- `--format markdown`: human-readable report mirroring the terminal
  grouping, suitable for pasting into a PR description.

## Error handling

- Invalid URL / unreachable host / clone failure → clear error message to
  stderr, exit code 1.
- Clone auth failure on what looks like a private repo → message pointing
  the user at configuring SSH keys / a git credential helper, or passing
  `--token`.
- No manifests found for any registered ecosystem → informational message,
  exit code 0 (not an error — the repo may simply not use a supported
  ecosystem).
- Individual registry/OSV request failure → isolated per dependency (see
  "Unknown" classification above), summarized at the end of the report.
- Rate limiting (429) → retry with exponential backoff (max 1 retry),
  bounded concurrency via `p-limit` to avoid triggering it in the first
  place.

## Testing strategy

- Unit tests per ecosystem plugin: `parse()` against fixture manifests
  (including monorepo-style and lockfile-present/absent variants),
  `resolveVersion()`/`toOsvQuery()` against mocked HTTP responses.
- HTTP mocking (`msw` or `nock`) for all registry and OSV calls — no real
  network access in the test suite.
- Integration test for the orchestrator against a local git repository
  fixture created on the fly in a temp dir (`git init` + commit fixture
  manifests) — validates discovery/clone/pipeline wiring without depending
  on network or a real remote host.
- TDD workflow for implementation (tests written before plugin/orchestrator
  logic), per standard project practice.

## Tech stack

- Node.js 22, TypeScript
- `commander` — CLI argument parsing
- `execa` — shelling out to `git`
- native `fetch` — HTTP to registries and OSV.dev
- `p-limit` — bounded concurrency
- `ora`, `chalk`, `cli-table3` — terminal UX
- `zod` — validating external API responses
- `vitest` — test runner
- Package manager: npm

## Open items / future work (not v1)

- `--fail-on <critical|warning>` flag to make this usable as a CI gate.
- Additional ecosystems (Java/Maven, Ruby/Bundler) via the plugin interface.
- Optional EOL awareness for known runtimes/frameworks (e.g. via
  endoflife.date) when a manifest declares an engine/runtime version
  constraint (`engines.node`, `python_requires`, `go` directive).

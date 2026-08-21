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

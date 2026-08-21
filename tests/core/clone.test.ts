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

  it('never leaks the token into the thrown error, even embedded in the underlying command', async () => {
    const secret = 'SUPER_SECRET_TOKEN_123';
    const bogusUrl = 'https://depcheck-does-not-exist.invalid/repo.git';

    let caught: CloneError | undefined;
    try {
      await cloneRepo(bogusUrl, { token: secret });
    } catch (err) {
      caught = err as CloneError;
    }

    expect(caught).toBeInstanceOf(CloneError);
    const causeWithCommand = caught!.cause as Error & { command?: string; escapedCommand?: string };
    expect(caught!.message).not.toContain(secret);
    expect(causeWithCommand.message).not.toContain(secret);
    if (causeWithCommand.command) expect(causeWithCommand.command).not.toContain(secret);
    if (causeWithCommand.escapedCommand) expect(causeWithCommand.escapedCommand).not.toContain(secret);
  });
});

describe('cleanupClone', () => {
  it('removes the given directory', async () => {
    const dir = await cloneRepo(sourceRepoDir);
    await cleanupClone(dir);
    await expect(stat(dir)).rejects.toThrow();
  });
});

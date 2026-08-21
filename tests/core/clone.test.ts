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

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

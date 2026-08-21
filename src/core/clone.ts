import { execa } from 'execa';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface CloneOptions {
  token?: string;
}

function redactCredentials(text: string): string {
  return text.replace(/https:\/\/[^@\s]+@/g, 'https://***@');
}

export class CloneError extends Error {
  constructor(public readonly url: string, public readonly cause: Error) {
    const causeWithCommand = cause as Error & { command?: string; escapedCommand?: string };
    if (causeWithCommand.message) causeWithCommand.message = redactCredentials(causeWithCommand.message);
    if (causeWithCommand.command) causeWithCommand.command = redactCredentials(causeWithCommand.command);
    if (causeWithCommand.escapedCommand) {
      causeWithCommand.escapedCommand = redactCredentials(causeWithCommand.escapedCommand);
    }
    super(`Failed to clone ${url}: ${causeWithCommand.message}`);
    this.cause = causeWithCommand;
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

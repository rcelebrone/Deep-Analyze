#!/usr/bin/env node
import { Command } from 'commander';
import ora from 'ora';
import { pathToFileURL } from 'node:url';
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  buildProgram().parseAsync(process.argv);
}

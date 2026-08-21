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

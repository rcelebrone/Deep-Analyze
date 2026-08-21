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

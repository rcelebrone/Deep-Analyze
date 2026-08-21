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

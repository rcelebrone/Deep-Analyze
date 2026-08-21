export type EcosystemId = 'npm' | 'pypi' | 'go' | 'packagist';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface Vulnerability {
  id: string;
  severity: Severity;
  summary: string;
}

export interface ManifestRef {
  ecosystem: EcosystemId;
  manifestPath: string;
  lockfilePath?: string;
}

export interface DependencyRef {
  ecosystem: EcosystemId;
  name: string;
  declaredRange: string;
  isDev: boolean;
  manifestPath: string;
}

export interface VersionInfo {
  resolvedCurrent: string;
  latest: string;
  majorsBehind: number;
  minorsBehind: number;
}

export type Classification = 'critical' | 'warning' | 'ok' | 'unknown';

export interface OsvBatchQueryEntry {
  package: { name: string; ecosystem: string };
  version: string;
}

export interface DependencyReport {
  ecosystem: EcosystemId;
  name: string;
  manifestPath: string;
  isDev: boolean;
  version?: VersionInfo;
  vulnerabilities: Vulnerability[];
  classification: Classification;
  unknownReason?: string;
}

export interface CheckupResult {
  manifestsScanned: number;
  dependencies: DependencyReport[];
}

export interface EcosystemPlugin {
  id: EcosystemId;
  manifestFilenames: string[];
  discover(repoRoot: string): Promise<ManifestRef[]>;
  parse(manifest: ManifestRef): Promise<DependencyRef[]>;
  resolveVersion(dep: DependencyRef, manifest: ManifestRef): Promise<VersionInfo>;
  toOsvQuery(dep: DependencyRef, version: VersionInfo): OsvBatchQueryEntry;
}

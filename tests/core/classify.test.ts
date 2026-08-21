import { describe, expect, it } from 'vitest';
import { classify } from '../../src/core/classify.js';

const noVersion = undefined;

describe('classify', () => {
  it('returns unknown when a lookup failed', () => {
    const result = classify({ vulnerabilities: [], majorThreshold: 3, unknownReason: 'registry timeout' });
    expect(result).toBe('unknown');
  });

  it('returns critical for a HIGH severity vulnerability', () => {
    const result = classify({
      vulnerabilities: [{ id: 'GHSA-1', severity: 'HIGH', summary: 'x' }],
      majorThreshold: 3,
    });
    expect(result).toBe('critical');
  });

  it('returns critical for a CRITICAL severity vulnerability', () => {
    const result = classify({
      vulnerabilities: [{ id: 'GHSA-1', severity: 'CRITICAL', summary: 'x' }],
      majorThreshold: 3,
    });
    expect(result).toBe('critical');
  });

  it('returns critical when majorsBehind meets the threshold', () => {
    const result = classify({
      version: { resolvedCurrent: '1.0.0', latest: '4.0.0', majorsBehind: 3, minorsBehind: 0 },
      vulnerabilities: [],
      majorThreshold: 3,
    });
    expect(result).toBe('critical');
  });

  it('returns warning for a LOW/MEDIUM severity vulnerability', () => {
    const result = classify({
      vulnerabilities: [{ id: 'GHSA-1', severity: 'LOW', summary: 'x' }],
      majorThreshold: 3,
    });
    expect(result).toBe('warning');
  });

  it('returns warning when majorsBehind is below threshold but above zero', () => {
    const result = classify({
      version: { resolvedCurrent: '1.0.0', latest: '2.0.0', majorsBehind: 1, minorsBehind: 0 },
      vulnerabilities: [],
      majorThreshold: 3,
    });
    expect(result).toBe('warning');
  });

  it('returns warning when only minorsBehind is nonzero', () => {
    const result = classify({
      version: { resolvedCurrent: '1.0.0', latest: '1.4.0', majorsBehind: 0, minorsBehind: 4 },
      vulnerabilities: [],
      majorThreshold: 3,
    });
    expect(result).toBe('warning');
  });

  it('returns ok when up to date with no vulnerabilities', () => {
    const result = classify({
      version: { resolvedCurrent: '1.0.0', latest: '1.0.0', majorsBehind: 0, minorsBehind: 0 },
      vulnerabilities: [],
      majorThreshold: 3,
    });
    expect(result).toBe('ok');
  });

  it('returns ok when no version info and no vulnerabilities', () => {
    const result = classify({ version: noVersion, vulnerabilities: [], majorThreshold: 3 });
    expect(result).toBe('ok');
  });
});

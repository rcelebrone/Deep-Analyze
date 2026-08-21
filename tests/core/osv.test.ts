import { describe, expect, it, vi } from 'vitest';
import { queryOsvBatch } from '../../src/core/osv.js';

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, statusText: 'error', json: async () => body };
}

describe('queryOsvBatch', () => {
  it('returns an empty array without calling fetch when entries is empty', async () => {
    const fetchFn = vi.fn();
    const result = await queryOsvBatch([], fetchFn as unknown as typeof fetch);
    expect(result).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps batch results back to positional vulnerability details', async () => {
    const entries = [
      { package: { name: 'left-pad', ecosystem: 'npm' }, version: '1.0.0' },
      { package: { name: 'safe-pkg', ecosystem: 'npm' }, version: '2.0.0' },
    ];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ vulns: [{ id: 'GHSA-1' }] }, {}] })
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: 'GHSA-1', summary: 'bad', database_specific: { severity: 'HIGH' } })
      );

    const result = await queryOsvBatch(entries, fetchFn as unknown as typeof fetch);

    expect(result).toEqual([
      [{ id: 'GHSA-1', severity: 'HIGH', summary: 'bad' }],
      [],
    ]);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.osv.dev/v1/querybatch',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetchFn).toHaveBeenCalledWith('https://api.osv.dev/v1/vulns/GHSA-1');
  });

  it('defaults severity to MEDIUM when the detail omits it', async () => {
    const entries = [{ package: { name: 'left-pad', ecosystem: 'npm' }, version: '1.0.0' }];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{ vulns: [{ id: 'GHSA-2' }] }] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'GHSA-2' }));

    const result = await queryOsvBatch(entries, fetchFn as unknown as typeof fetch);
    expect(result).toEqual([[{ id: 'GHSA-2', severity: 'MEDIUM', summary: '' }]]);
  });

  it('throws when the batch request fails', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(jsonResponse({}, false));
    await expect(
      queryOsvBatch([{ package: { name: 'x', ecosystem: 'npm' }, version: '1.0.0' }], fetchFn as unknown as typeof fetch)
    ).rejects.toThrow('OSV batch query failed');
  });

  it('isolates a single failed vuln-detail fetch instead of dropping or failing the whole batch', async () => {
    const entries = [
      { package: { name: 'ok-pkg', ecosystem: 'npm' }, version: '1.0.0' },
      { package: { name: 'bad-detail-pkg', ecosystem: 'npm' }, version: '1.0.0' },
    ];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ results: [{ vulns: [{ id: 'GHSA-1' }] }, { vulns: [{ id: 'GHSA-2' }] }] })
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: 'GHSA-1', summary: 'bad', database_specific: { severity: 'HIGH' } })
      )
      .mockResolvedValueOnce(jsonResponse({}, false));

    const result = await queryOsvBatch(entries, fetchFn as unknown as typeof fetch);

    expect(result[0]).toEqual([{ id: 'GHSA-1', severity: 'HIGH', summary: 'bad' }]);
    expect(result[1]).toHaveLength(1);
    expect(result[1][0].id).toBe('GHSA-2');
    expect(result[1][0].severity).toBe('MEDIUM');
    expect(result[1][0].summary).toContain('Details unavailable');
  });

  it('splits requests exceeding the 1000-entry OSV batch limit into multiple chunked POSTs', async () => {
    const entries = Array.from({ length: 1500 }, (_, i) => ({
      package: { name: `pkg-${i}`, ecosystem: 'npm' },
      version: '1.0.0',
    }));

    const fetchFn = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
      const { queries } = JSON.parse(init.body) as { queries: unknown[] };
      return jsonResponse({ results: queries.map(() => ({})) });
    });

    const result = await queryOsvBatch(entries, fetchFn as unknown as typeof fetch);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    const firstChunk = JSON.parse(fetchFn.mock.calls[0][1].body).queries;
    const secondChunk = JSON.parse(fetchFn.mock.calls[1][1].body).queries;
    expect(firstChunk).toHaveLength(1000);
    expect(secondChunk).toHaveLength(500);
    expect(result).toHaveLength(1500);
    expect(result.every((v) => Array.isArray(v) && v.length === 0)).toBe(true);
  });
});

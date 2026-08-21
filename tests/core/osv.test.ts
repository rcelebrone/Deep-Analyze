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
});

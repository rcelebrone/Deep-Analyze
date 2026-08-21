import { z } from 'zod';
import type { OsvBatchQueryEntry, Severity, Vulnerability } from './types.js';

const OSV_BATCH_URL = 'https://api.osv.dev/v1/querybatch';
const OSV_VULN_URL = 'https://api.osv.dev/v1/vulns';

type FetchFn = typeof fetch;

const BatchResponseSchema = z.object({
  results: z.array(z.object({ vulns: z.array(z.object({ id: z.string() })).optional() })),
});

const VulnDetailSchema = z.object({
  id: z.string(),
  summary: z.string().optional(),
  database_specific: z.object({ severity: z.string().optional() }).optional(),
});

type VulnDetail = z.infer<typeof VulnDetailSchema>;

function severityFromDetail(detail: VulnDetail): Severity {
  const dbSeverity = detail.database_specific?.severity?.toUpperCase();
  if (dbSeverity === 'CRITICAL' || dbSeverity === 'HIGH' || dbSeverity === 'MEDIUM' || dbSeverity === 'LOW') {
    return dbSeverity;
  }
  return 'MEDIUM';
}

const OSV_BATCH_LIMIT = 1000;

export async function queryOsvBatch(
  entries: OsvBatchQueryEntry[],
  fetchFn: FetchFn = fetch
): Promise<Vulnerability[][]> {
  if (entries.length === 0) return [];

  const idsPerEntry: string[][] = [];
  for (let i = 0; i < entries.length; i += OSV_BATCH_LIMIT) {
    const chunk = entries.slice(i, i + OSV_BATCH_LIMIT);
    const res = await fetchFn(OSV_BATCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: chunk }),
    });
    if (!res.ok) {
      throw new Error(`OSV batch query failed: ${res.status} ${res.statusText}`);
    }
    const body = BatchResponseSchema.parse(await res.json());
    idsPerEntry.push(...body.results.map((r) => r.vulns?.map((v) => v.id) ?? []));
  }

  const allIds = Array.from(new Set(idsPerEntry.flat()));
  const detailsById = new Map<string, Vulnerability>();
  for (const id of allIds) {
    try {
      const detail = await fetchVulnDetail(id, fetchFn);
      detailsById.set(id, { id, severity: severityFromDetail(detail), summary: detail.summary ?? '' });
    } catch (err) {
      detailsById.set(id, {
        id,
        severity: 'MEDIUM',
        summary: `Details unavailable: ${(err as Error).message}`,
      });
    }
  }

  return idsPerEntry.map((ids) =>
    ids.map((id) => detailsById.get(id)).filter((v): v is Vulnerability => v !== undefined)
  );
}

async function fetchVulnDetail(id: string, fetchFn: FetchFn): Promise<VulnDetail> {
  const res = await fetchFn(`${OSV_VULN_URL}/${id}`);
  if (!res.ok) {
    throw new Error(`OSV vuln detail fetch failed for ${id}: ${res.status}`);
  }
  return VulnDetailSchema.parse(await res.json());
}

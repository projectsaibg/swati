/**
 * Sujalam Bharat Integration Layer — Phase 5 data classification.
 *
 * The master prompt requires that household-level information is not exposed
 * through public interfaces. This module classifies each entity field and
 * redacts non-PUBLIC fields from anonymous (unauthenticated) responses. The
 * finest grain in the demo is village/service-area aggregates (household and
 * FHTC counts) — there is no individual PII — but the classification framework
 * is here so real household data would be protected the same way.
 *
 *  - PUBLIC    : safe on the public read surface (ids, names, geography, status)
 *  - INTERNAL  : visible to signed-in users only (demographic aggregates)
 *  - SENSITIVE : household-level counts; signed-in only, and never on public reads
 */

export type Classification = 'PUBLIC' | 'INTERNAL' | 'SENSITIVE';

// Field names are consistent across entity types, so classify by name.
const SENSITIVE_FIELDS = new Set(['households', 'fhtc', 'targetHouseholds']);
const INTERNAL_FIELDS = new Set(['population']);

export function classifyField(field: string): Classification {
  if (SENSITIVE_FIELDS.has(field)) return 'SENSITIVE';
  if (INTERNAL_FIELDS.has(field)) return 'INTERNAL';
  return 'PUBLIC';
}

export function isPublicField(field: string): boolean {
  return classifyField(field) === 'PUBLIC';
}

/**
 * Redact non-PUBLIC fields from a record for a given viewer. Signed-in viewers
 * see everything; anonymous viewers get non-PUBLIC values nulled out. Returns a
 * copy plus the list of fields that were redacted.
 */
export function redactRecord(record: Record<string, unknown>, authed: boolean): { record: Record<string, unknown>; redactedFields: string[] } {
  if (authed) return { record: { ...record }, redactedFields: [] };
  const out: Record<string, unknown> = {};
  const redactedFields: string[] = [];
  for (const [k, v] of Object.entries(record)) {
    if (isPublicField(k)) out[k] = v;
    else { out[k] = null; redactedFields.push(k); }
  }
  return { record: out, redactedFields };
}

/** The classification summary, for the field-mapping UI and audit. */
export function classificationSummary() {
  return {
    sensitive: [...SENSITIVE_FIELDS],
    internal: [...INTERNAL_FIELDS],
    note: 'SENSITIVE and INTERNAL fields are redacted from public (unauthenticated) responses. Sign in to view them.',
  };
}

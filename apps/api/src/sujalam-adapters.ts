/**
 * Sujalam Bharat Integration Layer — Phase 3 provider adapters (MOCK).
 *
 * The adapter is the seam behind which a real government API would sit. Nothing
 * here contacts a network: every adapter is an in-process MOCK that returns
 * deterministic results so sync/import are demoable and testable. Swapping in a
 * real integration later means implementing ProviderAdapter against the actual
 * API — the sync runner and UI do not change.
 *
 * Deterministic by design: outcomes derive from a hash of the internal id, so a
 * given record behaves the same across runs (a stable demo, and testable).
 */

export type IntegrationSystem = 'SUJALAM_BHARAT' | 'JJM_1_0';
export type PushState = 'SUCCESS' | 'FAILED';

export interface PushInput {
  internalId: string;
  externalId?: string | null;
  label: string;
  payload: Record<string, unknown>;
}
export interface PushOutcome {
  internalId: string;
  state: PushState;
  externalId?: string | null;
  message?: string;
}

export interface PullEntity {
  internalId: string;
  externalId?: string | null;
  label: string;
  fields: Record<string, unknown>;
}
export interface PullOutcome {
  internalId: string;
  conflict: boolean;
  field?: string;
  internalValue?: unknown;
  externalValue?: unknown;
}

export interface LegacyRecord {
  externalId: string; // JJM asset id
  sourceRef: string | null; // linked SWATI infrastructure id, when known
  category: string;
  label: string;
}

export interface ProviderAdapter {
  system: IntegrationSystem;
  supportsPush: boolean;
  supportsPull: boolean;
  push?(entityType: string, inputs: PushInput[]): PushOutcome[];
  pull?(entityType: string, entities: PullEntity[]): PullOutcome[];
  pullLegacy?(existingExternalIds: string[]): LegacyRecord[];
}

/** Small deterministic string hash (matches the seed style used elsewhere). */
export function hashStr(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
  return n;
}

/** Deterministic push outcome — ~96% succeed, ~4% fail (mock provider reject). */
export function decidePushState(seed: number): PushState {
  return seed % 25 === 0 ? 'FAILED' : 'SUCCESS';
}

const EXT_PREFIX: Record<string, string> = {
  SCHEME: 'SB-WB', SERVICE_AREA: 'SB-SA', SUJAL_GAON: 'SB-VIL', INFRASTRUCTURE: 'SB-INF',
};
// The single field the mock government proposes a change to, per entity type.
export const CONFLICT_FIELD: Record<string, string> = {
  SCHEME: 'status', SERVICE_AREA: 'serviceStatus', SUJAL_GAON: 'supplyStatus', INFRASTRUCTURE: 'category',
};
// The value the mock government proposes for that field (differs from our seed).
const CONFLICT_VALUE: Record<string, string> = {
  SCHEME: 'UNDER_REVIEW', SERVICE_AREA: 'RE_VERIFY', SUJAL_GAON: 'INTERMITTENT', INFRASTRUCTURE: 'PUMPING_STATION',
};

export class SujalamBharatMockAdapter implements ProviderAdapter {
  system: IntegrationSystem = 'SUJALAM_BHARAT';
  supportsPush = true;
  supportsPull = true;

  push(entityType: string, inputs: PushInput[]): PushOutcome[] {
    const prefix = EXT_PREFIX[entityType] ?? 'SB';
    return inputs.map((inp) => {
      const seed = hashStr(inp.internalId);
      const state = decidePushState(seed);
      if (state === 'FAILED') {
        return { internalId: inp.internalId, state, message: 'Mock provider rejected the record (simulated transport error).' };
      }
      return { internalId: inp.internalId, state, externalId: inp.externalId ?? `${prefix}-${9000 + (seed % 1000)}` };
    });
  }

  pull(entityType: string, entities: PullEntity[]): PullOutcome[] {
    const field = CONFLICT_FIELD[entityType];
    const proposed = CONFLICT_VALUE[entityType];
    return entities.map((e) => {
      // Only mapped records are eligible for a government-side change.
      const eligible = !!e.externalId;
      const pick = hashStr(e.internalId + ':pull') % 5 === 0; // ~20%
      if (!eligible || !pick || !field) return { internalId: e.internalId, conflict: false };
      const internalValue = e.fields[field];
      if (internalValue === proposed) return { internalId: e.internalId, conflict: false };
      return { internalId: e.internalId, conflict: true, field, internalValue, externalValue: proposed };
    });
  }
}

export class Jjm10MockAdapter implements ProviderAdapter {
  system: IntegrationSystem = 'JJM_1_0';
  supportsPush = false; // legacy system: pull-only (retrofitting inventory)
  supportsPull = false;

  /**
   * Return a deterministic batch of legacy asset records. Some carry a sourceRef
   * that matches an existing SWATI infrastructure id (they will link); the rest
   * are legacy-only assets (they will be created).
   */
  pullLegacy(existingExternalIds: string[]): LegacyRecord[] {
    const out: LegacyRecord[] = [];
    // 10 that link back to existing mapped assets (JJM-ASSET-8000..8009).
    for (let i = 0; i < 10; i++) {
      out.push({
        externalId: `JJM-ASSET-${8000 + i}`,
        sourceRef: existingExternalIds.includes(`JJM-ASSET-${8000 + i}`) ? `JJM-ASSET-${8000 + i}` : null,
        category: 'MOTOR_PUMP',
        label: `Legacy pump ${8000 + i}`,
      });
    }
    // 5 legacy-only assets not yet in SWATI (they will be created on import).
    for (let i = 0; i < 5; i++) {
      out.push({ externalId: `JJM-ASSET-${9500 + i}`, sourceRef: null, category: 'OHR', label: `Legacy OHR ${9500 + i}` });
    }
    return out;
  }
}

export function adapterFor(system: string): ProviderAdapter {
  return system === 'JJM_1_0' ? new Jjm10MockAdapter() : new SujalamBharatMockAdapter();
}

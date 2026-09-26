import { describe, it, expect } from 'vitest';
import {
  hashStr, decidePushState, SujalamBharatMockAdapter, Jjm10MockAdapter, adapterFor,
} from './sujalam-adapters';

describe('hashStr / decidePushState', () => {
  it('is deterministic', () => {
    expect(hashStr('abc')).toBe(hashStr('abc'));
  });
  it('mostly succeeds, occasionally fails', () => {
    let ok = 0, fail = 0;
    for (let i = 0; i < 200; i++) (decidePushState(i) === 'SUCCESS' ? ok++ : fail++);
    expect(ok).toBeGreaterThan(fail * 10); // heavily skewed to success
    expect(fail).toBeGreaterThan(0);
  });
});

describe('SujalamBharatMockAdapter.push', () => {
  const a = new SujalamBharatMockAdapter();
  it('assigns an external id on success when none exists', () => {
    const out = a.push('SCHEME', [{ internalId: 'x1', externalId: null, label: 'S', payload: {} }]);
    expect(out).toHaveLength(1);
    if (out[0].state === 'SUCCESS') {
      expect(out[0].externalId).toMatch(/^SB-WB-/);
    }
  });
  it('preserves an existing external id', () => {
    // find an id that succeeds
    let id = '';
    for (let i = 0; i < 100; i++) { if (decidePushState(hashStr('keep' + i)) === 'SUCCESS') { id = 'keep' + i; break; } }
    const out = a.push('INFRASTRUCTURE', [{ internalId: id, externalId: 'SB-INF-123', label: 'A', payload: {} }]);
    expect(out[0].externalId).toBe('SB-INF-123');
  });
  it('is deterministic across calls', () => {
    const inp = [{ internalId: 'stable', externalId: null, label: 'S', payload: {} }];
    expect(a.push('SCHEME', inp)).toEqual(a.push('SCHEME', inp));
  });
});

describe('SujalamBharatMockAdapter.pull', () => {
  const a = new SujalamBharatMockAdapter();
  it('never flags a conflict on an unmapped (no external id) entity', () => {
    const outs = a.pull('SCHEME', Array.from({ length: 50 }, (_, i) => ({ internalId: 'u' + i, externalId: null, label: 'x', fields: { status: 'ACTIVE' } })));
    expect(outs.every((o) => o.conflict === false)).toBe(true);
  });
  it('flags some conflicts on mapped entities with the configured field', () => {
    const outs = a.pull('SCHEME', Array.from({ length: 100 }, (_, i) => ({ internalId: 'm' + i, externalId: 'SB-WB-' + i, label: 'x', fields: { status: 'ACTIVE' } })));
    const conflicts = outs.filter((o) => o.conflict);
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].field).toBe('status');
    expect(conflicts[0].externalValue).toBe('UNDER_REVIEW');
  });
  it('does not conflict when internal already equals the proposed value', () => {
    const outs = a.pull('SCHEME', Array.from({ length: 100 }, (_, i) => ({ internalId: 'm' + i, externalId: 'SB-WB-' + i, label: 'x', fields: { status: 'UNDER_REVIEW' } })));
    expect(outs.every((o) => o.conflict === false)).toBe(true);
  });
});

describe('Jjm10MockAdapter', () => {
  it('is pull-only and returns a mix of linkable + new legacy records', () => {
    const a = new Jjm10MockAdapter();
    expect(a.supportsPush).toBe(false);
    const recs = a.pullLegacy(['JJM-ASSET-8000', 'JJM-ASSET-8001']);
    expect(recs.length).toBe(15);
    expect(recs.filter((r) => r.sourceRef).length).toBe(2); // only the two known ones link
    expect(recs.filter((r) => !r.sourceRef).length).toBe(13);
  });
});

describe('adapterFor', () => {
  it('routes to the right adapter', () => {
    expect(adapterFor('JJM_1_0').system).toBe('JJM_1_0');
    expect(adapterFor('SUJALAM_BHARAT').system).toBe('SUJALAM_BHARAT');
    expect(adapterFor('anything-else').system).toBe('SUJALAM_BHARAT');
  });
});

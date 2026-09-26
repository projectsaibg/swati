import { describe, it, expect } from 'vitest';
import { classifyField, isPublicField, redactRecord } from './sujalam-classification';

describe('classifyField', () => {
  it('marks household-level counts SENSITIVE', () => {
    expect(classifyField('households')).toBe('SENSITIVE');
    expect(classifyField('fhtc')).toBe('SENSITIVE');
    expect(classifyField('targetHouseholds')).toBe('SENSITIVE');
  });
  it('marks demographic aggregates INTERNAL', () => {
    expect(classifyField('population')).toBe('INTERNAL');
  });
  it('treats ids/geography/status as PUBLIC', () => {
    for (const f of ['schemeName', 'district', 'sujalamBharatId', 'status', 'gisBoundary', 'latitude']) {
      expect(classifyField(f)).toBe('PUBLIC');
      expect(isPublicField(f)).toBe(true);
    }
  });
});

describe('redactRecord', () => {
  const rec = { name: 'Village 1', district: 'Nadia', population: 1200, households: 300, fhtc: 250 };
  it('returns everything for an authenticated viewer', () => {
    const { record, redactedFields } = redactRecord(rec, true);
    expect(record).toEqual(rec);
    expect(redactedFields).toHaveLength(0);
  });
  it('nulls non-PUBLIC fields for an anonymous viewer', () => {
    const { record, redactedFields } = redactRecord(rec, false);
    expect(record.name).toBe('Village 1');
    expect(record.district).toBe('Nadia');
    expect(record.population).toBeNull();
    expect(record.households).toBeNull();
    expect(record.fhtc).toBeNull();
    expect(redactedFields.sort()).toEqual(['fhtc', 'households', 'population']);
  });
  it('does not mutate the input record', () => {
    redactRecord(rec, false);
    expect(rec.households).toBe(300);
  });
});

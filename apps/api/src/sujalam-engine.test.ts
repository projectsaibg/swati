import { describe, it, expect } from 'vitest';
import { applyTransform, mapEntity, evaluateRule, validateEntity, isEmpty } from './sujalam-engine';

describe('applyTransform', () => {
  it('passes through DIRECT and normalises undefined to null', () => {
    expect(applyTransform('x', 'DIRECT')).toBe('x');
    expect(applyTransform(undefined, 'DIRECT')).toBeNull();
  });
  it('emits the arg for CONSTANT regardless of input', () => {
    expect(applyTransform('ignored', 'CONSTANT', 'West Bengal')).toBe('West Bengal');
  });
  it('handles string casings and trim', () => {
    expect(applyTransform('aB', 'UPPERCASE')).toBe('AB');
    expect(applyTransform('aB', 'LOWERCASE')).toBe('ab');
    expect(applyTransform('pump station', 'TITLECASE')).toBe('Pump Station');
    expect(applyTransform('  x  ', 'TRIM')).toBe('x');
  });
  it('coerces NUMBER and BOOLEAN, returning null for empties', () => {
    expect(applyTransform('42', 'NUMBER')).toBe(42);
    expect(applyTransform('nope', 'NUMBER')).toBeNull();
    expect(applyTransform('', 'NUMBER')).toBeNull();
    expect(applyTransform('active', 'BOOLEAN')).toBe(true);
    expect(applyTransform('0', 'BOOLEAN')).toBe(false);
  });
  it('DATE_ISO produces an ISO string or null', () => {
    expect(applyTransform(new Date('2026-01-02T00:00:00Z'), 'DATE_ISO')).toBe('2026-01-02T00:00:00.000Z');
    expect(applyTransform('not-a-date', 'DATE_ISO')).toBeNull();
  });
  it('MAP looks up via a JSON table and falls back to the raw value', () => {
    const table = JSON.stringify({ PWS: 'PIPED_WATER_SUPPLY' });
    expect(applyTransform('PWS', 'MAP', table)).toBe('PIPED_WATER_SUPPLY');
    expect(applyTransform('OTHER', 'MAP', table)).toBe('OTHER');
    expect(applyTransform('PWS', 'MAP', 'not json')).toBe('PWS');
  });
  it('treats an unknown transform as DIRECT', () => {
    expect(applyTransform('v', 'WHATEVER')).toBe('v');
  });
});

describe('mapEntity', () => {
  const mappings = [
    { internalField: 'schemeName', externalField: 'scheme_name', transform: 'DIRECT', required: true },
    { internalField: 'state', externalField: 'state', transform: 'CONSTANT', transformArg: 'West Bengal' },
    { internalField: 'schemeType', externalField: 'scheme_type', transform: 'MAP', transformArg: JSON.stringify({ PWS: 'PIPED' }) },
    { internalField: 'district', externalField: 'district', transform: 'DIRECT', required: true },
    { internalField: 'skipMe', externalField: 'skip', transform: 'DIRECT', enabled: false },
  ];
  it('builds the external payload and applies transforms', () => {
    const { external } = mapEntity({ schemeName: 'Test', schemeType: 'PWS', district: 'Nadia' }, mappings);
    expect(external).toEqual({ scheme_name: 'Test', state: 'West Bengal', scheme_type: 'PIPED', district: 'Nadia' });
  });
  it('reports required fields that came out empty', () => {
    const { missingRequired } = mapEntity({ schemeName: 'Test' }, mappings);
    expect(missingRequired).toContain('district');
    expect(missingRequired).not.toContain('schemeName');
  });
  it('skips disabled mappings', () => {
    const { external } = mapEntity({ skipMe: 'x', schemeName: 'a', district: 'b' }, mappings);
    expect(external).not.toHaveProperty('skip');
  });
});

describe('evaluateRule', () => {
  it('REQUIRED fails on empty', () => {
    expect(evaluateRule({ a: '' }, { field: 'a', ruleType: 'REQUIRED', message: 'need a' })).not.toBeNull();
    expect(evaluateRule({ a: 'x' }, { field: 'a', ruleType: 'REQUIRED', message: 'need a' })).toBeNull();
  });
  it('REGEX only checks present values', () => {
    const rule = { field: 'id', ruleType: 'REGEX', param: '^SB-WB-\\d+$', message: 'bad id' };
    expect(evaluateRule({ id: 'SB-WB-1001' }, rule)).toBeNull();
    expect(evaluateRule({ id: 'oops' }, rule)).not.toBeNull();
    expect(evaluateRule({ id: null }, rule)).toBeNull();
  });
  it('a broken REGEX config never blocks', () => {
    const rule = { field: 'id', ruleType: 'REGEX', param: '(', message: 'bad' };
    expect(evaluateRule({ id: 'x' }, rule)).toBeNull();
  });
  it('MIN/MAX bound numbers', () => {
    expect(evaluateRule({ n: 5 }, { field: 'n', ruleType: 'MIN', param: '10', message: 'too low' })).not.toBeNull();
    expect(evaluateRule({ n: 50 }, { field: 'n', ruleType: 'MAX', param: '10', message: 'too high' })).not.toBeNull();
    expect(evaluateRule({ n: 10 }, { field: 'n', ruleType: 'MIN', param: '10', message: 'ok' })).toBeNull();
  });
  it('ENUM restricts to allowed values', () => {
    const rule = { field: 's', ruleType: 'ENUM', param: 'ACTIVE, INACTIVE', message: 'bad status' };
    expect(evaluateRule({ s: 'ACTIVE' }, rule)).toBeNull();
    expect(evaluateRule({ s: 'CLOSED' }, rule)).not.toBeNull();
  });
  it('respects a disabled rule', () => {
    expect(evaluateRule({ a: '' }, { field: 'a', ruleType: 'REQUIRED', message: 'x', enabled: false })).toBeNull();
  });
});

describe('validateEntity', () => {
  const rules = [
    { field: 'name', ruleType: 'REQUIRED', message: 'name required' },
    { field: 'sujalamBharatId', ruleType: 'REGEX', param: '^SB-', severity: 'WARNING', message: 'gov id missing/invalid' },
  ];
  it('is valid with zero errors; warnings do not affect validity', () => {
    const r = validateEntity({ name: 'X', sujalamBharatId: null }, rules);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });
  it('is invalid when an ERROR rule fails', () => {
    const r = validateEntity({ name: '', sujalamBharatId: 'nope' }, rules);
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(1);
    expect(r.warnings).toHaveLength(1);
  });
});

describe('isEmpty', () => {
  it('treats null/undefined/blank strings as empty', () => {
    expect(isEmpty(null)).toBe(true);
    expect(isEmpty(undefined)).toBe(true);
    expect(isEmpty('   ')).toBe(true);
    expect(isEmpty(0)).toBe(false);
    expect(isEmpty('x')).toBe(false);
  });
});

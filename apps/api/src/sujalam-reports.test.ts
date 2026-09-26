import { describe, it, expect } from 'vitest';
import { overallReadiness } from './sujalam-reports';

describe('overallReadiness', () => {
  it('is the rounded mean of per-type mapping percentages', () => {
    expect(overallReadiness([{ mappedPct: 100 }, { mappedPct: 50 }, { mappedPct: 0 }])).toBe(50);
    expect(overallReadiness([{ mappedPct: 67 }, { mappedPct: 80 }])).toBe(74); // (147/2)=73.5 -> 74
  });
  it('is 0 for no rows', () => {
    expect(overallReadiness([])).toBe(0);
  });
});

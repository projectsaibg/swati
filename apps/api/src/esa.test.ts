import { describe, it, expect } from 'vitest';
import { computeEsa, severityFor } from './esa';

const healthy = {
  voltageV: 414, ratedVoltageV: 415, currentA: 118, ratedCurrentA: 130, powerFactor: 0.9,
  voltageUnbalancePct: 0.8, currentUnbalancePct: 2.4, thdVoltagePct: 2.4, thdCurrentPct: 3.8,
  loadPct: 82, efficiencyPct: 92, speedRpm: 1478, ratedSpeedRpm: 1480,
  vibrationMmS: 2.2, windingTempC: 60, bearingTempC: 54,
};
const faulted = {
  voltageV: 400, ratedVoltageV: 415, currentA: 170, ratedCurrentA: 155, powerFactor: 0.82,
  voltageUnbalancePct: 4.6, currentUnbalancePct: 12, thdVoltagePct: 6.5, thdCurrentPct: 12.5,
  loadPct: 112, efficiencyPct: 74, speedRpm: 1455, ratedSpeedRpm: 1485,
  vibrationMmS: 6.9, windingTempC: 84, bearingTempC: 89,
};

describe('computeEsa', () => {
  it('scores a healthy motor high and INFO', () => {
    const r = computeEsa(healthy);
    expect(r.healthScore).not.toBeNull();
    expect(r.healthScore!).toBeGreaterThanOrEqual(85);
    expect(r.severity).toBe('INFO');
    expect(r.drivers).toHaveLength(0);
  });

  it('scores a faulted motor low and flags drivers', () => {
    const r = computeEsa(faulted);
    expect(r.healthScore!).toBeLessThan(70);
    expect(['ALARM', 'CRITICAL']).toContain(r.severity);
    expect(r.drivers.length).toBeGreaterThan(0);
    // healthy motor should always outscore the faulted one
    expect(computeEsa(healthy).healthScore!).toBeGreaterThan(r.healthScore!);
  });

  it('returns null sub-indices and health when inputs are absent', () => {
    const r = computeEsa({});
    expect(r.healthScore).toBeNull();
    expect(r.statorIndex).toBeNull();
    expect(r.severity).toBe('INFO');
  });

  it('clamps every sub-index to 0..100', () => {
    for (const r of [computeEsa(healthy), computeEsa(faulted)]) {
      for (const v of [r.supplyIndex, r.statorIndex, r.rotorIndex, r.eccentricityIndex, r.bearingIndex, r.loadIndex]) {
        if (v != null) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe('severityFor', () => {
  it('maps score bands to severities', () => {
    expect(severityFor(90)).toBe('INFO');
    expect(severityFor(78)).toBe('WATCH');
    expect(severityFor(60)).toBe('ALARM');
    expect(severityFor(40)).toBe('CRITICAL');
    expect(severityFor(null)).toBe('INFO');
  });
});

/**
 * SWATI ESA (Electrical Signature Analysis) scoring engine — pure functions.
 *
 * Produces six condition sub-indices (0..100, higher = healthier) and a
 * weighted overall health score from an induction motor / pump's electrical,
 * mechanical and thermal readings. This is a threshold/derived-feature model
 * (a legitimate, deterministic condition-scoring approach). Full MCSA current
 * spectrum FFT with rotor sideband detection is the heavier Phase-2 DSP step
 * (TS/WASM); this engine already consumes those derived features when present.
 *
 * No I/O, no framework deps — trivially unit-testable.
 */
export interface EsaInput {
  voltageV?: number | null;
  ratedVoltageV?: number | null;
  currentA?: number | null;
  ratedCurrentA?: number | null;
  powerFactor?: number | null;
  voltageUnbalancePct?: number | null;
  currentUnbalancePct?: number | null;
  thdVoltagePct?: number | null;
  thdCurrentPct?: number | null;
  loadPct?: number | null;
  efficiencyPct?: number | null;
  speedRpm?: number | null;
  ratedSpeedRpm?: number | null;
  vibrationMmS?: number | null;
  windingTempC?: number | null;
  bearingTempC?: number | null;
}

export type Severity = 'INFO' | 'WATCH' | 'ALARM' | 'CRITICAL';

export interface EsaResult {
  supplyIndex: number | null;
  statorIndex: number | null;
  rotorIndex: number | null;
  eccentricityIndex: number | null;
  bearingIndex: number | null;
  loadIndex: number | null;
  healthScore: number | null;
  severity: Severity;
  drivers: string[]; // sub-indices below the WATCH line, worst first
}

const num = (v: unknown): number | null =>
  v == null || Number.isNaN(Number(v)) ? null : Number(v);

/**
 * Map a "higher is worse" measurement onto a 0..100 score.
 * value <= good -> 100, value >= bad -> 0, linear in between.
 */
function scoreHiBad(value: number | null, good: number, bad: number): number | null {
  if (value == null) return null;
  if (value <= good) return 100;
  if (value >= bad) return 0;
  return Math.round(((bad - value) / (bad - good)) * 100);
}

/** Symmetric deviation score: |value - target| scaled by tolerance band. */
function scoreDeviation(value: number | null, target: number, goodBand: number, badBand: number): number | null {
  if (value == null || !target) return null;
  const devPct = Math.abs((value - target) / target) * 100;
  return scoreHiBad(devPct, goodBand, badBand);
}

/** Average the non-null component scores; null if none are available. */
function combine(...scores: (number | null)[]): number | null {
  const present = scores.filter((s): s is number => s != null);
  if (present.length === 0) return null;
  return Math.round(present.reduce((a, b) => a + b, 0) / present.length);
}

// Weights for the overall health score (sum need not be 1; we renormalize over
// whatever sub-indices are available).
const WEIGHTS: Record<string, number> = {
  stator: 0.18, rotor: 0.18, bearing: 0.2, eccentricity: 0.16, supply: 0.14, load: 0.14,
};

const LABELS: Record<string, string> = {
  supply: 'Power supply quality',
  stator: 'Stator winding',
  rotor: 'Rotor bars',
  eccentricity: 'Air-gap eccentricity',
  bearing: 'Bearing',
  load: 'Load / efficiency',
};

export function computeEsa(input: EsaInput): EsaResult {
  const i = input;

  // Supply: voltage unbalance, voltage THD, deviation from nameplate voltage.
  const supplyIndex = combine(
    scoreHiBad(num(i.voltageUnbalancePct), 1, 5),
    scoreHiBad(num(i.thdVoltagePct), 3, 8),
    scoreDeviation(num(i.voltageV), num(i.ratedVoltageV) ?? 0, 2, 10),
  );

  // Stator: current unbalance + current THD (winding faults raise both).
  const statorIndex = combine(
    scoreHiBad(num(i.currentUnbalancePct), 5, 20),
    scoreHiBad(num(i.thdCurrentPct), 5, 15),
  );

  // Rotor: broken-bar surrogate from current unbalance emphasized under load.
  // (Real MCSA uses +/-2sf sidebands; consumed in Phase-2.)
  const load = num(i.loadPct);
  const loadFactor = load == null ? 1 : Math.min(1.4, Math.max(0.6, load / 75));
  const rotorRaw = scoreHiBad(num(i.currentUnbalancePct), 2, 10);
  const rotorIndex = rotorRaw == null ? null : Math.max(0, Math.min(100, Math.round(100 - (100 - rotorRaw) * loadFactor)));

  // Eccentricity: vibration (ISO 10816 zones) + speed deviation from nameplate.
  const eccentricityIndex = combine(
    scoreHiBad(num(i.vibrationMmS), 2.8, 7.1),
    scoreDeviation(num(i.speedRpm), num(i.ratedSpeedRpm) ?? 0, 1, 5),
  );

  // Bearing: bearing temperature + vibration.
  const bearingIndex = combine(
    scoreHiBad(num(i.bearingTempC), 60, 90),
    scoreHiBad(num(i.vibrationMmS), 2.8, 7.1),
  );

  // Load / efficiency: penalize under/over-load and low efficiency.
  const loadDev = load == null ? null : scoreHiBad(Math.abs(load - 80), 20, 55); // ideal ~60-100%
  const loadIndex = combine(loadDev, scoreHiBad(num(i.efficiencyPct) == null ? null : 100 - Number(i.efficiencyPct), 10, 30));

  const parts: Record<string, number | null> = {
    supply: supplyIndex, stator: statorIndex, rotor: rotorIndex,
    eccentricity: eccentricityIndex, bearing: bearingIndex, load: loadIndex,
  };

  let wSum = 0;
  let acc = 0;
  for (const [k, v] of Object.entries(parts)) {
    if (v == null) continue;
    wSum += WEIGHTS[k];
    acc += WEIGHTS[k] * v;
  }
  const healthScore = wSum === 0 ? null : Math.round((acc / wSum) * 10) / 10;

  const drivers = Object.entries(parts)
    .filter(([, v]) => v != null && v < 70)
    .sort((a, b) => (a[1] as number) - (b[1] as number))
    .map(([k]) => LABELS[k]);

  return {
    supplyIndex, statorIndex, rotorIndex, eccentricityIndex, bearingIndex, loadIndex,
    healthScore, severity: severityFor(healthScore), drivers,
  };
}

export function severityFor(health: number | null): Severity {
  if (health == null) return 'INFO';
  if (health >= 85) return 'INFO';
  if (health >= 70) return 'WATCH';
  if (health >= 50) return 'ALARM';
  return 'CRITICAL';
}

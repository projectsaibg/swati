/**
 * SWATI seed — run once after `prisma migrate deploy`.
 * Compiled to dist/scripts/seed.js; run with `node dist/scripts/seed.js`.
 * Creates the deployment + feature flags (tier preset), the role ladder, an
 * admin user (prints the password ONCE), and the West Bengal pump-house network
 * with its adjacent assets and a lively demo time-series.
 */
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { FEATURE_REGISTRY, featuresForTier, ALWAYS_ON, TierName } from '../features';
import { computeEsa } from '../esa';
import { PUMP_HOUSES } from '../data/pumphouses';

const prisma = new PrismaClient();

async function main() {
  const TIER: TierName = 'QUANTUM';

  // Deployment
  let deployment = await prisma.deployment.findFirst();
  if (!deployment) {
    deployment = await prisma.deployment.create({ data: { name: 'SWATI', tier: TIER } });
  }

  // Feature flags from the tier preset
  const enabled = featuresForTier(TIER);
  for (const f of FEATURE_REGISTRY) {
    await prisma.featureFlag.upsert({
      where: { deploymentId_key: { deploymentId: deployment.id, key: f.key } },
      update: {},
      create: {
        deploymentId: deployment.id,
        key: f.key,
        enabled: enabled.has(f.key),
        visibility: f.visibility,
      },
    });
  }
  for (const key of ALWAYS_ON) {
    await prisma.featureFlag.upsert({
      where: { deploymentId_key: { deploymentId: deployment.id, key } },
      update: {},
      create: { deploymentId: deployment.id, key, enabled: true, visibility: 'LOGIN' },
    });
  }

  // Role ladder (rank + reports_to + permissions)
  const roleDefs = [
    { name: 'Administrator', rank: 100, reportsTo: null as string | null, permissions: ['*'] },
    { name: 'Executive Engineer', rank: 80, reportsTo: 'Administrator', permissions: ['feature.act', 'alert.ack', 'data.enter', 'comms.send', 'gis.import', 'valve.operate', 'assets.manage'] },
    { name: 'Assistant Engineer', rank: 60, reportsTo: 'Executive Engineer', permissions: ['feature.act', 'alert.ack', 'data.enter', 'comms.send', 'valve.operate'] },
    { name: 'Field Officer', rank: 40, reportsTo: 'Assistant Engineer', permissions: ['data.enter', 'comms.send', 'alert.ack', 'gis.import'] },
  ];
  const roleIds: Record<string, string> = {};
  for (const r of roleDefs) {
    const role = await prisma.role.upsert({
      where: { name: r.name },
      update: { rank: r.rank, permissions: r.permissions },
      create: { name: r.name, rank: r.rank, permissions: r.permissions },
    });
    roleIds[r.name] = role.id;
  }
  for (const r of roleDefs) {
    if (r.reportsTo) {
      await prisma.role.update({
        where: { id: roleIds[r.name] },
        data: { reportsToId: roleIds[r.reportsTo] },
      });
    }
  }

  // Admin user
  const adminEmail = 'admin@swati.local';
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  let adminPassword = '(unchanged — user already existed)';
  if (!existing) {
    adminPassword = randomBytes(6).toString('base64url');
    await prisma.user.create({
      data: {
        email: adminEmail,
        name: 'Administrator',
        passwordHash: await argon2.hash(adminPassword),
        roleId: roleIds['Administrator'],
      },
    });
  }

  // Demo motor-pumps with realistic raw electrical readings so the ESA engine
  // has real inputs. Three condition tiers: healthy / watch / fault. Each gets
  // a short time-series (2h spacing) so the health trend line is populated.
  // Positioned in West Bengal, clustered near the flagship Uttar Tajpur scheme.
  const now = Date.now();
  const motorProfiles = [
    {
      tag: 'MTR-01', name: 'Raw water pump 1', latitude: 22.94010, longitude: 88.71680,
      rated: { kw: 75, v: 415, a: 130, rpm: 1480 },
      base: { voltageV: 414, currentA: 118, powerFactor: 0.9, voltageUnbalancePct: 0.8, currentUnbalancePct: 2.4, thdVoltagePct: 2.4, thdCurrentPct: 3.8, loadPct: 82, efficiencyPct: 92, speedRpm: 1478, vibrationMmS: 2.2, windingTempC: 60, bearingTempC: 54 },
    },
    {
      tag: 'MTR-02', name: 'Clear water pump 2', latitude: 22.93920, longitude: 88.71540,
      rated: { kw: 55, v: 415, a: 98, rpm: 1470 },
      base: { voltageV: 410, currentA: 90, powerFactor: 0.87, voltageUnbalancePct: 2.1, currentUnbalancePct: 6.5, thdVoltagePct: 4.2, thdCurrentPct: 7.5, loadPct: 90, efficiencyPct: 86, speedRpm: 1466, vibrationMmS: 4.3, windingTempC: 70, bearingTempC: 73 },
    },
    {
      tag: 'MTR-03', name: 'Booster pump 3', latitude: 22.94080, longitude: 88.71780,
      rated: { kw: 90, v: 415, a: 155, rpm: 1485 },
      base: { voltageV: 400, currentA: 170, powerFactor: 0.82, voltageUnbalancePct: 4.6, currentUnbalancePct: 12, thdVoltagePct: 6.5, thdCurrentPct: 12.5, loadPct: 112, efficiencyPct: 74, speedRpm: 1455, vibrationMmS: 6.9, windingTempC: 84, bearingTempC: 89 },
    },
  ];
  const STEPS = 8;
  for (const m of motorProfiles) {
    const ratedData = {
      ratedPowerKw: m.rated.kw, ratedVoltageV: m.rated.v, ratedCurrentA: m.rated.a, ratedSpeedRpm: m.rated.rpm,
    };
    const asset = await prisma.asset.upsert({
      where: { tag: m.tag },
      update: { ...ratedData, status: 'RUNNING', latitude: m.latitude, longitude: m.longitude },
      create: {
        tag: m.tag, name: m.name, type: 'MOTOR_PUMP',
        latitude: m.latitude, longitude: m.longitude, ...ratedData,
      },
    });
    // Idempotent reseed: clear prior synthetic demo readings + condition alerts.
    await prisma.reading.deleteMany({ where: { assetId: asset.id, source: 'demo' } });
    await prisma.alert.deleteMany({ where: { assetId: asset.id, metric: 'healthScore' } });
    let lastEsa: ReturnType<typeof computeEsa> | null = null;
    for (let step = 0; step < STEPS; step++) {
      // Slight degradation toward the latest sample (older = healthier).
      const age = (STEPS - 1 - step) / (STEPS - 1); // 1 oldest -> 0 newest
      const drift = 1 - age * 0.12; // older readings 12% closer to nominal
      const b = m.base;
      const input = {
        voltageV: b.voltageV, ratedVoltageV: m.rated.v,
        currentA: b.currentA, ratedCurrentA: m.rated.a,
        powerFactor: b.powerFactor,
        voltageUnbalancePct: b.voltageUnbalancePct * drift,
        currentUnbalancePct: b.currentUnbalancePct * drift,
        thdVoltagePct: b.thdVoltagePct * drift,
        thdCurrentPct: b.thdCurrentPct * drift,
        loadPct: b.loadPct, efficiencyPct: b.efficiencyPct,
        speedRpm: b.speedRpm, ratedSpeedRpm: m.rated.rpm,
        vibrationMmS: b.vibrationMmS * drift,
        windingTempC: b.windingTempC, bearingTempC: b.bearingTempC * drift,
      };
      const esa = computeEsa(input);
      lastEsa = esa;
      await prisma.reading.create({
        data: {
          assetId: asset.id,
          ts: new Date(now - (STEPS - 1 - step) * 2 * 60 * 60 * 1000),
          voltageV: input.voltageV, currentA: input.currentA, powerFactor: input.powerFactor,
          voltageUnbalancePct: input.voltageUnbalancePct, currentUnbalancePct: input.currentUnbalancePct,
          thdVoltagePct: input.thdVoltagePct, thdCurrentPct: input.thdCurrentPct,
          loadPct: input.loadPct, efficiencyPct: input.efficiencyPct, speedRpm: input.speedRpm,
          vibrationMmS: input.vibrationMmS, windingTempC: input.windingTempC, bearingTempC: input.bearingTempC,
          statorIndex: esa.statorIndex, rotorIndex: esa.rotorIndex, bearingIndex: esa.bearingIndex,
          eccentricityIndex: esa.eccentricityIndex, supplyIndex: esa.supplyIndex, loadIndex: esa.loadIndex,
          healthScore: esa.healthScore,
          source: 'demo',
        },
      });
    }
    if (lastEsa && (lastEsa.severity === 'ALARM' || lastEsa.severity === 'CRITICAL')) {
      await prisma.asset.update({ where: { id: asset.id }, data: { status: 'FAULT' } });
      await prisma.alert.create({
        data: {
          assetId: asset.id,
          category: lastEsa.drivers[0] ?? 'Condition',
          severity: lastEsa.severity,
          message: `${m.tag}: ${lastEsa.drivers[0] ?? 'Condition'} degraded (health ${lastEsa.healthScore})`,
          metric: 'healthScore',
          valueNum: lastEsa.healthScore,
          status: 'OPEN',
        },
      });
    }
  }

  // Demo IoT sensor devices — one per new sensor family, each on a different
  // transport, with a Connectivity row and a couple of recent measurements.
  // Clustered near the flagship Uttar Tajpur scheme in West Bengal.
  const demoDevices: Array<{
    tag: string;
    name: string;
    type: 'FLOW_METER' | 'PRESSURE_SENSOR' | 'WATER_LEVEL' | 'CHLORINATOR';
    transport: 'MQTT' | 'LORAWAN' | 'WIFI' | 'SIM' | 'RTU_MODBUS' | 'HTTP';
    gatewayId: string;
    config: Record<string, unknown>;
    latitude: number;
    longitude: number;
    metric: string;
    unit: string;
    values: number[];
  }> = [
    {
      tag: 'FM-01', name: 'DMA-1 bulk flow meter', type: 'FLOW_METER', transport: 'MQTT',
      gatewayId: 'RTU-GW-01', config: { broker: 'tcp://gw01.local:1883', topic: 'swati/fm-01/telemetry' },
      latitude: 22.93960, longitude: 88.71620, metric: 'flow_m3h', unit: 'm3/h', values: [128.4, 131.2, 129.7],
    },
    {
      tag: 'PS-01', name: 'Zone-3 pressure sensor', type: 'PRESSURE_SENSOR', transport: 'LORAWAN',
      gatewayId: 'LORA-GW-02', config: { devEui: '00-00-00-00-00-00-00-01', appPort: 2 },
      latitude: 22.93885, longitude: 88.71500, metric: 'pressure_bar', unit: 'bar', values: [3.1, 3.0, 2.9],
    },
    {
      tag: 'WL-01', name: 'OHT-2 water level', type: 'WATER_LEVEL', transport: 'SIM',
      gatewayId: 'SIM-MODEM-03', config: { apn: 'iot.operator.net', imei: '000000000000000' },
      latitude: 22.94110, longitude: 88.71720, metric: 'level_m', unit: 'm', values: [4.6, 4.4, 4.2],
    },
    {
      tag: 'CL-01', name: 'WTP chlorinator', type: 'CHLORINATOR', transport: 'RTU_MODBUS',
      gatewayId: 'RTU-GW-01', config: { unitId: 5, register: 40001 },
      latitude: 22.94030, longitude: 88.71585, metric: 'residual_cl_mgl', unit: 'mg/L', values: [0.52, 0.55, 0.49],
    },
  ];
  for (const d of demoDevices) {
    const asset = await prisma.asset.upsert({
      where: { tag: d.tag },
      update: { latitude: d.latitude, longitude: d.longitude },
      create: {
        tag: d.tag,
        name: d.name,
        type: d.type,
        latitude: d.latitude,
        longitude: d.longitude,
        status: 'RUNNING',
        connectivity: {
          create: { transport: d.transport, config: d.config as any, gatewayId: d.gatewayId, lastSeen: new Date() },
        },
      },
    });
    for (let i = 0; i < d.values.length; i++) {
      await prisma.measurement.create({
        data: {
          assetId: asset.id,
          ts: new Date(now - (d.values.length - 1 - i) * 15 * 60 * 1000), // 15-min spacing
          metric: d.metric,
          value: d.values[i],
          unit: d.unit,
          quality: 'good',
          source: 'demo',
        },
      });
    }
  }

  // A couple of demo users so the admin Users editor is not empty.
  const demoUsers = [
    { email: 'ee@swati.local', name: 'Priya Executive', role: 'Executive Engineer', manager: adminEmail },
    { email: 'ae@swati.local', name: 'Arun Assistant', role: 'Assistant Engineer', manager: 'ee@swati.local' },
    { email: 'fo@swati.local', name: 'Field Officer One', role: 'Field Officer', manager: 'ae@swati.local' },
  ];
  const userIds: Record<string, string> = {};
  for (const u of demoUsers) {
    const existingU = await prisma.user.findUnique({ where: { email: u.email } });
    if (existingU) {
      userIds[u.email] = existingU.id;
      continue;
    }
    const created = await prisma.user.create({
      data: {
        email: u.email,
        name: u.name,
        passwordHash: await argon2.hash(randomBytes(9).toString('base64url')),
        roleId: roleIds[u.role],
      },
    });
    userIds[u.email] = created.id;
  }
  // Wire manager overrides now that all ids exist (admin id resolved by email).
  const adminUser = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (adminUser) userIds[adminEmail] = adminUser.id;
  for (const u of demoUsers) {
    const managerId = userIds[u.manager];
    if (managerId) await prisma.user.update({ where: { id: userIds[u.email] }, data: { managerId } });
  }

  // --- West Bengal pump-house network -------------------------------------
  // One PUMP_STATION Site per pump house from the master sheet, at its real
  // coordinates, carrying its administrative geography (district/block/zone/
  // scheme/type). Every pump house gets adjacent assets a few dozen metres away
  // (pump, overhead reservoir, tank level, pressure, flow meter, WQ analyser) —
  // the same generic Asset/Measurement path real RTU/API data uses, so the
  // whole network scales by adding rows, not code. The demo simulator animates
  // every analyser, pump and sensor live.
  const WQ_UNITS: Record<string, string> = {
    ph: '', turbidity_ntu: 'NTU', do_mgl: 'mg/L', temp_c: 'C',
    conductivity_uscm: 'uS/cm', tds_mgl: 'mg/L', hardness_mgl: 'mg/L', coliform_cfu: 'CFU/100mL',
  };
  const HIST_WQ = 24; // ~48 min of history at 2-min spacing; simulator extends live
  const HIST_PS = 12; // ~1h at 5-min spacing

  // Deterministic per-site variation so sites differ without random churn.
  const hash = (s: string) => { let n = 0; for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0; return n; };

  // Metre-scale offsets (deg) placing assets adjacent to the pump house.
  const OFF = {
    pump: [0, 0], ohr: [0.0004, 0.00022], lvl: [0.00043, 0.00025],
    pres: [-0.0003, 0.0003], flow: [0.00022, -0.0004], wq: [-0.0004, -0.00022],
  } as const;
  const at = (lat: number, lng: number, d: readonly [number, number]) =>
    ({ latitude: +(lat + d[0]).toFixed(7), longitude: +(lng + d[1]).toFixed(7) });

  // Clear prior demo/sim time-series once so reseed is idempotent and fast.
  await prisma.measurement.deleteMany({ where: { source: { in: ['demo', 'sim'] } } });
  await prisma.reading.deleteMany({ where: { source: 'ps-demo' } });

  // Remove stale pre-geolocation demo data so the map is purely West Bengal.
  // Any asset outside the WB bounding box is a leftover placeholder (the real
  // motors/devices above were already relocated into WB). Clear child rows
  // first to satisfy foreign keys, then drop the old code-less sites.
  // Outside the WB box, or missing coordinates entirely (old placeholder pumps
  // whose parent site was deleted, leaving siteId null). Every real asset here
  // has WB coordinates, so a null/out-of-box coordinate marks a leftover.
  const stale = await prisma.asset.findMany({
    where: { OR: [{ latitude: null }, { longitude: null }, { latitude: { lt: 21 } }, { latitude: { gt: 28 } }, { longitude: { lt: 85 } }, { longitude: { gt: 91 } }] },
    select: { id: true },
  });
  const staleIds = stale.map((a) => a.id);
  if (staleIds.length) {
    await prisma.measurement.deleteMany({ where: { assetId: { in: staleIds } } });
    await prisma.reading.deleteMany({ where: { assetId: { in: staleIds } } });
    await prisma.alert.deleteMany({ where: { assetId: { in: staleIds } } });
    await prisma.connectivity.deleteMany({ where: { assetId: { in: staleIds } } });
    await prisma.asset.deleteMany({ where: { id: { in: staleIds } } });
  }
  // Old placeholder sites (DMA North/South, Pumphouse Alpha/Beta) carried no
  // pump-house code; every real pump house from the master sheet has one.
  await prisma.site.deleteMany({ where: { code: null } });

  const buf: { assetId: string; ts: Date; metric: string; value: number; unit: string; quality: string; source: string }[] = [];
  const flush = async (force = false) => {
    if (buf.length >= 5000 || (force && buf.length)) {
      await prisma.measurement.createMany({ data: buf.splice(0, buf.length) });
    }
  };
  // Buffered ESA condition readings for the pumps (Pump & Motor screen).
  const readingsBuf: any[] = [];

  // Deterministic electrical signature per pump: healthy vs degraded, varied
  // per site, so the ESA engine yields a real, non-degenerate health score.
  const pumpEsaBase = (s: number, bad: boolean) => {
    const j = (s % 10) / 10; // 0..0.9 jitter seed
    return bad
      ? { voltageV: 400, currentA: 168 + j * 4, powerFactor: 0.82, voltageUnbalancePct: 4.4, currentUnbalancePct: 11 + j, thdVoltagePct: 6.2, thdCurrentPct: 12, loadPct: 110, efficiencyPct: 75, speedRpm: 1456, vibrationMmS: 6.6, windingTempC: 83, bearingTempC: 88 }
      : { voltageV: 413, currentA: 116 + j * 6, powerFactor: 0.9, voltageUnbalancePct: 0.9 + j * 0.5, currentUnbalancePct: 2.2 + j, thdVoltagePct: 2.4, thdCurrentPct: 3.6 + j, loadPct: 80 + (s % 10), efficiencyPct: 91, speedRpm: 1478, vibrationMmS: 2.1 + j, windingTempC: 58 + (s % 8), bearingTempC: 52 + (s % 8) };
  };

  let phFault = 0;
  let phDegradedWq = 0;
  for (const ph of PUMP_HOUSES) {
    const seed = hash(ph.code);
    const intermediate = ph.phType === 'Intermediate';
    const name = `${ph.scheme} — ${ph.pumpHouse}`;
    // Showcase fill: the master sheet leaves ~67% of pump houses without a zone.
    // Synthesise a deterministic Zone I/II/III per scheme for those so the
    // District -> Block -> Zone filter is useful everywhere; keep real zones.
    const zone = ph.zone ?? `Zone ${['I', 'II', 'III'][hash(ph.scheme) % 3]}`;

    const site = await prisma.site.upsert({
      where: { code: ph.code },
      update: { name, kind: 'PUMP_STATION', latitude: ph.lat, longitude: ph.lng, district: ph.district, block: ph.block, zone, scheme: ph.scheme, phType: ph.phType },
      create: { code: ph.code, name, kind: 'PUMP_STATION', latitude: ph.lat, longitude: ph.lng, district: ph.district, block: ph.block, zone, scheme: ph.scheme, phType: ph.phType },
    });

    // Pump (one per pump house; larger for intermediate stations).
    const kw = intermediate ? 75 : 45;
    const faulted = seed % 17 === 0;
    if (faulted) phFault++;
    const pump = await prisma.asset.upsert({
      where: { tag: `${ph.code}-P1` },
      update: { siteId: site.id, type: 'MOTOR_PUMP', status: faulted ? 'FAULT' : 'RUNNING', ratedPowerKw: kw, ...at(ph.lat, ph.lng, OFF.pump) },
      create: { tag: `${ph.code}-P1`, name: `${name} pump`, type: 'MOTOR_PUMP', siteId: site.id, status: faulted ? 'FAULT' : 'RUNNING', ratedPowerKw: kw, ratedVoltageV: 415, ratedCurrentA: kw * 1.8, ratedSpeedRpm: 1480, ...at(ph.lat, ph.lng, OFF.pump) },
    });
    // Full electrical readings so the ESA engine produces real sub-indices and
    // health for the Pump & Motor screen (a short trend; simulator extends live).
    const pb = pumpEsaBase(seed, faulted);
    const PUMP_ESA_STEPS = 6;
    for (let step = 0; step < PUMP_ESA_STEPS; step++) {
      const age = (PUMP_ESA_STEPS - 1 - step) / (PUMP_ESA_STEPS - 1);
      const drift = 1 - age * 0.1;
      const input = {
        voltageV: pb.voltageV, ratedVoltageV: 415,
        currentA: pb.currentA, ratedCurrentA: kw * 1.8,
        powerFactor: pb.powerFactor,
        voltageUnbalancePct: pb.voltageUnbalancePct * drift,
        currentUnbalancePct: pb.currentUnbalancePct * drift,
        thdVoltagePct: pb.thdVoltagePct * drift,
        thdCurrentPct: pb.thdCurrentPct * drift,
        loadPct: pb.loadPct, efficiencyPct: pb.efficiencyPct,
        speedRpm: pb.speedRpm, ratedSpeedRpm: 1480,
        vibrationMmS: pb.vibrationMmS * drift,
        windingTempC: pb.windingTempC, bearingTempC: pb.bearingTempC * drift,
      };
      const esa = computeEsa(input);
      readingsBuf.push({
        assetId: pump.id, ts: new Date(now - (PUMP_ESA_STEPS - 1 - step) * 30 * 60 * 1000),
        voltageV: input.voltageV, currentA: input.currentA, powerFactor: input.powerFactor,
        voltageUnbalancePct: input.voltageUnbalancePct, currentUnbalancePct: input.currentUnbalancePct,
        thdVoltagePct: input.thdVoltagePct, thdCurrentPct: input.thdCurrentPct,
        loadPct: input.loadPct, efficiencyPct: input.efficiencyPct, speedRpm: input.speedRpm,
        vibrationMmS: input.vibrationMmS, windingTempC: input.windingTempC, bearingTempC: input.bearingTempC,
        statorIndex: esa.statorIndex, rotorIndex: esa.rotorIndex, bearingIndex: esa.bearingIndex,
        eccentricityIndex: esa.eccentricityIndex, supplyIndex: esa.supplyIndex, loadIndex: esa.loadIndex,
        healthScore: esa.healthScore, source: 'ps-demo',
      });
    }
    await prisma.alert.deleteMany({ where: { assetId: pump.id, metric: 'healthScore' } });
    if (faulted) {
      await prisma.alert.create({ data: { assetId: pump.id, category: 'Condition', severity: 'ALARM', message: `${ph.code}: pump health degraded`, metric: 'healthScore', valueNum: 44, status: 'OPEN' } });
    }
    const flowBase = intermediate ? 45 : 28;
    for (let step = 0; step < HIST_PS; step++) {
      const t = now - (HIST_PS - 1 - step) * 5 * 60 * 1000;
      const on = !faulted;
      const power = on ? Math.round(kw * (0.82 + 0.06 * Math.sin(step / 6 + seed)) * 10) / 10 : 0;
      const flow = on ? Math.round(flowBase * (0.9 + 0.08 * Math.sin(step / 5 + seed)) * 10) / 10 : 0;
      buf.push({ assetId: pump.id, ts: new Date(t), metric: 'run_state', value: on ? 1 : 0, unit: '', quality: 'good', source: 'demo' });
      buf.push({ assetId: pump.id, ts: new Date(t), metric: 'power_kw', value: power, unit: 'kW', quality: 'good', source: 'demo' });
      buf.push({ assetId: pump.id, ts: new Date(t), metric: 'flow_klh', value: flow, unit: 'kL/h', quality: 'good', source: 'demo' });
    }

    // Overhead reservoir (OHR): physical structure marker adjacent to the PH.
    await prisma.asset.upsert({
      where: { tag: `${ph.code}-OHR` },
      update: { siteId: site.id, type: 'OHT', ...at(ph.lat, ph.lng, OFF.ohr) },
      create: { tag: `${ph.code}-OHR`, name: `${name} OHR`, type: 'OHT', siteId: site.id, status: 'RUNNING', ...at(ph.lat, ph.lng, OFF.ohr) },
    });

    // Station sensors: tank level (on the OHR), pressure, flow meter.
    const sensors = [
      { tag: `${ph.code}-LVL`, type: 'WATER_LEVEL', off: OFF.lvl, metrics: [{ m: 'level_pct', u: '%', base: 78 + (seed % 12) }, { m: 'storage_m3', u: 'm3', base: (78 + (seed % 12)) * 1.2 }] },
      { tag: `${ph.code}-PRES`, type: 'PRESSURE_SENSOR', off: OFF.pres, metrics: [{ m: 'pressure_bar', u: 'bar', base: 4.8 + (seed % 20) / 10 }] },
      { tag: `${ph.code}-FLOW`, type: 'FLOW_METER', off: OFF.flow, metrics: [{ m: 'net_flow_klh', u: 'kL/h', base: flowBase * 1.6 }] },
    ];
    for (const sen of sensors) {
      const a = await prisma.asset.upsert({
        where: { tag: sen.tag },
        update: { siteId: site.id, type: sen.type as any, ...at(ph.lat, ph.lng, sen.off) },
        create: { tag: sen.tag, name: `${name} ${sen.type}`, type: sen.type as any, siteId: site.id, status: 'RUNNING', ...at(ph.lat, ph.lng, sen.off) },
      });
      await prisma.connectivity.upsert({
        where: { assetId: a.id },
        update: { transport: 'RTU_MODBUS', gatewayId: `RTU-${ph.code}`, lastSeen: new Date() },
        create: { assetId: a.id, transport: 'RTU_MODBUS', config: {} as any, gatewayId: `RTU-${ph.code}`, lastSeen: new Date() },
      });
      for (let step = 0; step < HIST_PS; step++) {
        const t = now - (HIST_PS - 1 - step) * 5 * 60 * 1000;
        for (const mm of sen.metrics) {
          const v = Math.round(mm.base * (1 + 0.06 * Math.sin(step / 7 + seed)) * 100) / 100;
          buf.push({ assetId: a.id, ts: new Date(t), metric: mm.m, value: v, unit: mm.u, quality: 'good', source: 'demo' });
        }
      }
    }
    await flush();

    // Water Quality Analyser adjacent to the pump house. A deterministic slice
    // of sites runs degraded so the WQ compliance view has real breaches.
    const degraded = seed % 11 === 0;
    if (degraded) phDegradedWq++;
    const base: Record<string, number> = degraded
      ? { ph: 5.9, turbidity_ntu: 6.8, do_mgl: 3.0, temp_c: 32, conductivity_uscm: 1950, tds_mgl: 1750, hardness_mgl: 640, coliform_cfu: 11 }
      : { ph: 7.1 + (seed % 6) / 20, turbidity_ntu: 0.6 + (seed % 8) / 10, do_mgl: 6.2 + (seed % 5) / 10, temp_c: 26 + (seed % 5), conductivity_uscm: 420 + (seed % 200), tds_mgl: 280 + (seed % 140), hardness_mgl: 150 + (seed % 90), coliform_cfu: 0 };
    const wqa = await prisma.asset.upsert({
      where: { tag: `${ph.code}-WQ` },
      update: { siteId: site.id, type: 'WQ_ANALYSER', ...at(ph.lat, ph.lng, OFF.wq) },
      create: { tag: `${ph.code}-WQ`, name: `${name} WQ analyser`, type: 'WQ_ANALYSER', siteId: site.id, status: 'RUNNING', ...at(ph.lat, ph.lng, OFF.wq) },
    });
    await prisma.connectivity.upsert({
      where: { assetId: wqa.id },
      update: { transport: 'RTU_MODBUS', gatewayId: `RTU-${ph.code}`, lastSeen: new Date() },
      create: { assetId: wqa.id, transport: 'RTU_MODBUS', config: { gateway: `RTU-${ph.code}` } as any, gatewayId: `RTU-${ph.code}`, lastSeen: new Date() },
    });
    for (let step = 0; step < HIST_WQ; step++) {
      const ts = new Date(now - (HIST_WQ - 1 - step) * 2 * 60 * 1000);
      for (const [metric, b] of Object.entries(base)) {
        let value: number;
        if (metric === 'coliform_cfu') value = Math.max(0, Math.round(b + Math.sin(step / 5 + seed) * 1.5));
        else value = Math.round(b * (1 + 0.07 * Math.sin(step / 7 + seed)) * 100) / 100;
        buf.push({ assetId: wqa.id, ts, metric, value, unit: WQ_UNITS[metric] ?? '', quality: 'good', source: 'demo' });
      }
    }

    // Zone inlet valve for this pump house — geo-tagged so Valve Control shares
    // the District -> Block -> Zone filter and offers on/off per valve. On
    // reseed the operated status/position are preserved (update omits them).
    const vsp = [['Open', 100], ['Throttled', 60], ['Closed', 0]] as const;
    const vpick = vsp[seed % 3];
    const vcommon = {
      name: `${name} inlet`, area: `${ph.district} · ${ph.block}`,
      district: ph.district, block: ph.block, zone,
      valveType: seed % 2 ? 'Butterfly' : 'Gate',
      controllable: seed % 7 !== 0,
      upstreamBar: Math.round((5.2 + (seed % 12) / 10) * 100) / 100,
      downstreamBar: Math.round((3.0 + (seed % 20) / 10) * 100) / 100,
      flowKlmin: Math.round((6 + (seed % 18)) * 10) / 10,
      health: seed % 13 === 0 ? 'Attention' : 'Good',
    };
    await prisma.valve.upsert({
      where: { tag: `${ph.code}-VLV` },
      update: vcommon,
      create: { tag: `${ph.code}-VLV`, status: vpick[0], positionPct: vpick[1], ...vcommon },
    });
    await flush();
  }
  await flush(true);
  for (let i = 0; i < readingsBuf.length; i += 5000) {
    await prisma.reading.createMany({ data: readingsBuf.slice(i, i + 5000) });
  }
  console.log(`Seeded ${PUMP_HOUSES.length} pump houses (${phFault} faulted pumps, ${phDegradedWq} degraded WQ sites).`);

  // Remove legacy free-text-area valves (pre-geolocation). Every valve is now a
  // geo-tagged zone inlet valve created per pump house in the loop above; its
  // ValveOp audit rows cascade-delete with it.
  await prisma.valve.deleteMany({ where: { district: null } });

  // NRW records: per-area input vs billed across 6 months (improving trend).
  const nrwAreas = [
    { area: 'Nadia · Karimpur I', input: 42000, startNrw: 0.28, endNrw: 0.19 },
    { area: 'Nadia · Chapra', input: 38000, startNrw: 0.41, endNrw: 0.33 },
    { area: 'Nadia · Tehatta I', input: 55000, startNrw: 0.22, endNrw: 0.16 },
    { area: 'Purba Medinipur · Tamluk', input: 30000, startNrw: 0.35, endNrw: 0.30 },
  ];
  const nrwPeriods = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
  await prisma.nrwRecord.deleteMany({});
  const nrwRows: { area: string; period: string; inputKl: number; billedKl: number; nrwPct: number }[] = [];
  for (const a of nrwAreas) {
    for (let i = 0; i < nrwPeriods.length; i++) {
      const t = i / (nrwPeriods.length - 1);
      const nrw = a.startNrw + (a.endNrw - a.startNrw) * t;
      const input = Math.round(a.input * (1 + (Math.random() - 0.5) * 0.04));
      const billed = Math.round(input * (1 - nrw));
      nrwRows.push({ area: a.area, period: nrwPeriods[i], inputKl: input, billedKl: billed, nrwPct: Math.round(nrw * 1000) / 10 });
    }
  }
  await prisma.nrwRecord.createMany({ data: nrwRows });

  // Maintenance work orders: corrective (auto-raised from faulted pumps) plus a
  // preventive servicing schedule across a slice of sites, with realistic
  // statuses and due dates (some overdue). Geo columns are denormalised so the
  // Maintenance screen shares the District -> Block -> Zone filter.
  await prisma.workOrder.deleteMany({});
  const assignees = ['Priya Executive', 'Arun Assistant', 'Field Officer One'];
  const day = 24 * 60 * 60 * 1000;
  const woRows: any[] = [];
  let woN = 0;

  const faultedPumps = await prisma.asset.findMany({
    where: { type: 'MOTOR_PUMP', status: 'FAULT' },
    include: { site: { select: { id: true, name: true, district: true, block: true, zone: true } } },
  });
  for (const p of faultedPumps) {
    woN++;
    woRows.push({
      code: `WO-${String(woN).padStart(4, '0')}`,
      title: `Investigate pump fault — ${p.tag}`,
      type: 'CORRECTIVE', priority: woN % 2 === 0 ? 'CRITICAL' : 'HIGH', status: woN % 3 === 0 ? 'IN_PROGRESS' : 'OPEN',
      siteId: p.site?.id ?? null, siteName: p.site?.name ?? null, assetTag: p.tag,
      district: p.site?.district ?? null, block: p.site?.block ?? null, zone: p.site?.zone ?? null,
      assignee: assignees[woN % assignees.length],
      notes: 'Auto-raised from ESA fault. Inspect motor windings and bearings.',
      dueAt: new Date(now + ((woN % 4) - 1) * day),
    });
  }

  const svcSites = await prisma.site.findMany({ where: { kind: 'PUMP_STATION' }, select: { id: true, name: true, district: true, block: true, zone: true, code: true } });
  for (const s of svcSites) {
    const seed = hash(s.code ?? s.id);
    if (seed % 4 !== 0) continue; // ~25% of sites carry an active preventive WO
    woN++;
    const bucket = seed % 5;
    const status = bucket === 0 ? 'DONE' : bucket === 1 ? 'IN_PROGRESS' : 'OPEN';
    const dueOffset = (seed % 30) - 10; // -10..+19 days (some overdue)
    woRows.push({
      code: `WO-${String(woN).padStart(4, '0')}`,
      title: `Quarterly pump servicing — ${s.name.split(' — ')[0]}`,
      type: 'PREVENTIVE', priority: seed % 3 === 0 ? 'MEDIUM' : 'LOW', status,
      siteId: s.id, siteName: s.name, assetTag: null,
      district: s.district, block: s.block, zone: s.zone,
      assignee: assignees[seed % assignees.length],
      notes: 'Scheduled preventive maintenance: lubricate, inspect and test.',
      dueAt: new Date(now + dueOffset * day),
      completedAt: status === 'DONE' ? new Date(now - (seed % 20) * day) : null,
    });
  }
  await prisma.workOrder.createMany({ data: woRows });
  console.log(`Seeded ${woRows.length} work orders (${faultedPumps.length} corrective).`);

  // Billing & Revenue: per site per month (6 months) with an improving
  // collection-efficiency trend and per-site variation; arrears carry forward.
  await prisma.billingRecord.deleteMany({});
  const brRows: any[] = [];
  const billSites = await prisma.site.findMany({ where: { kind: 'PUMP_STATION' }, select: { id: true, name: true, district: true, block: true, zone: true, code: true } });
  for (const s of billSites) {
    const seed = hash(s.code ?? s.id);
    const connections = 200 + (seed % 900); // 200..1099
    const monthlyCharge = 180 + (seed % 60); // INR per connection per month
    let arrears = (seed % 5000) + 2000; // opening arrears
    for (let i = 0; i < nrwPeriods.length; i++) {
      const t = i / (nrwPeriods.length - 1);
      const eff = Math.max(0.5, Math.min(0.98, 0.70 + 0.20 * t + ((seed % 10) - 5) / 100));
      const demand = Math.round(connections * monthlyCharge);
      const collected = Math.round(demand * eff);
      arrears = Math.max(0, arrears + (demand - collected) - Math.round(arrears * 0.1));
      const billedKl = Math.round(connections * (12 + (seed % 8)));
      brRows.push({ siteId: s.id, siteName: s.name, district: s.district, block: s.block, zone: s.zone, period: nrwPeriods[i], connections, demandInr: demand, collectedInr: collected, arrearsInr: arrears, billedKl });
    }
  }
  for (let i = 0; i < brRows.length; i += 5000) await prisma.billingRecord.createMany({ data: brRows.slice(i, i + 5000) });
  console.log(`Seeded ${brRows.length} billing records.`);

  // -------------------------------------------------------------------------
  // Sujalam Bharat Integration Layer — Phase 1 foundation (DEMO / MOCK only).
  // Every row is demonstration data with dual identity (SWATI id + a clearly
  // synthetic government id). No official government API is contacted. Two mock
  // providers: Sujalam Bharat (bidirectional push+pull) and JJM 1.0 (pull-only
  // legacy import). Idempotent: clears the integration tables first.
  // -------------------------------------------------------------------------
  await prisma.syncRecord.deleteMany({});
  await prisma.syncJob.deleteMany({});
  await prisma.entityMapping.deleteMany({});
  await prisma.infrastructureMapping.deleteMany({});
  await prisma.sujalGaon.deleteMany({});
  await prisma.serviceArea.deleteMany({});
  await prisma.schemeProfile.deleteMany({});
  await prisma.integrationProvider.deleteMany({});
  await prisma.govAuditLog.deleteMany({});
  await prisma.legacyImport.deleteMany({});
  await prisma.fieldMapping.deleteMany({});
  await prisma.validationRule.deleteMany({});

  await prisma.integrationProvider.create({
    data: {
      system: 'SUJALAM_BHARAT', name: 'Sujalam Bharat (mock)', enabled: true, mockMode: true,
      supportsPush: true, supportsPull: true, autoSync: false, gisValidation: true,
      authType: 'MOCK_TOKEN', schemaVersion: 'demo-1',
    },
  });
  await prisma.integrationProvider.create({
    data: {
      system: 'JJM_1_0', name: 'JJM 1.0 legacy import (mock)', enabled: true, mockMode: true,
      supportsPush: false, supportsPull: true, autoSync: false, gisValidation: false,
      authType: 'MOCK_TOKEN', schemaVersion: 'jjm-legacy',
    },
  });

  // Pick 3 distinct real schemes from the pump-house network for the profiles.
  const schemeNames: string[] = [];
  for (const ph of PUMP_HOUSES) { if (!schemeNames.includes(ph.scheme)) schemeNames.push(ph.scheme); if (schemeNames.length >= 3) break; }

  const schemeIds: string[] = [];
  const schemeMapped: boolean[] = [];
  for (let si = 0; si < schemeNames.length; si++) {
    const nm = schemeNames[si];
    const sample = PUMP_HOUSES.find((p) => p.scheme === nm)!;
    const mapped = si < 2; // first 2 mapped, last one pending
    const sp = await prisma.schemeProfile.create({
      data: {
        schemeKey: `SCH-${si + 1}`,
        swatiSchemeId: `SWATI-SCH-${String(si + 1).padStart(3, '0')}`,
        sujalamBharatId: mapped ? `SB-WB-${1000 + si}` : null,
        schemeName: nm,
        schemeType: 'PWS',
        district: sample.district,
        block: sample.block,
        mappingStatus: mapped ? 'SYNCED' : 'IN_PROGRESS',
        verificationStatus: mapped ? 'VERIFIED' : 'UNVERIFIED',
        lastSyncedAt: mapped ? new Date() : null,
        demo: true,
      },
    });
    schemeIds.push(sp.id);
    schemeMapped.push(mapped);
  }

  // Build a small square GeoJSON polygon around a point (demo boundaries).
  const sqBoundary = (lat: number, lng: number, d: number) => ({
    type: 'Polygon',
    coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]],
  });

  // 10 service areas spread across the 3 schemes. Most carry a demo GIS boundary;
  // a couple are left without so the GIS_PRESENT validation still surfaces gaps.
  const serviceAreaIds: string[] = [];
  for (let i = 0; i < 10; i++) {
    const si = i % schemeIds.length;
    const seed = hash(`sa-${i}`);
    const ph = PUMP_HOUSES.find((p) => p.scheme === schemeNames[si])!;
    const hasGis = i % 5 !== 4; // leave i=4, i=9 without a boundary
    const sa = await prisma.serviceArea.create({
      data: {
        serviceAreaId: `SWATI-SA-${String(i + 1).padStart(3, '0')}`,
        schemeProfileId: schemeIds[si],
        sujalamBharatId: schemeMapped[si] ? `SB-SA-${2000 + i}` : null,
        name: `${schemeNames[si]} — Service Area ${i + 1}`,
        district: ph.district,
        population: 3000 + (seed % 7000),
        households: 600 + (seed % 1400),
        fhtc: 400 + (seed % 1000),
        targetHouseholds: 800 + (seed % 1200),
        supplySource: seed % 2 === 0 ? 'Surface (river)' : 'Ground (borewell)',
        supplyMode: 'Piped', supplyDurationHrs: 4 + (seed % 6), supplyFrequency: 'Daily',
        waterQualityStatus: 'OK', serviceStatus: 'ACTIVE',
        gisBoundary: hasGis ? sqBoundary(ph.lat + i * 0.012, ph.lng + i * 0.012, 0.02) : undefined,
      },
    });
    serviceAreaIds.push(sa.id);
  }

  // 25 Sujal Gaon villages, ~60% mapped; ~80% carry a demo GIS boundary.
  for (let i = 0; i < 25; i++) {
    const si = i % schemeIds.length;
    const seed = hash(`village-${i}`);
    const mapped = seed % 5 !== 0;
    const ph = PUMP_HOUSES.find((p) => p.scheme === schemeNames[si])!;
    const hasGis = i % 5 !== 4; // leave 5 villages without a boundary
    await prisma.sujalGaon.create({
      data: {
        sujalGaonId: mapped ? `SG-WB-${5000 + i}` : null,
        swatiVillageId: `SWATI-VIL-${String(i + 1).padStart(4, '0')}`,
        serviceAreaId: serviceAreaIds[i % serviceAreaIds.length],
        schemeProfileId: schemeIds[si],
        sujalamBharatId: mapped ? `SB-VIL-${6000 + i}` : null,
        name: `Village ${i + 1}`,
        district: ph.district,
        population: 800 + (seed % 2200),
        households: 150 + (seed % 350),
        fhtc: 100 + (seed % 250),
        supplyStatus: 'ACTIVE', supplyDurationHrs: 3 + (seed % 7),
        waterQualityStatus: 'OK',
        mappingStatus: mapped ? 'SYNCED' : 'NOT_MAPPED',
        gisBoundary: hasGis ? sqBoundary(ph.lat + (i % 8) * 0.01 - 0.03, ph.lng + (i % 8) * 0.01 - 0.03, 0.008) : undefined,
      },
    });
  }

  // 100 infrastructure mappings from real pump assets (dual identity).
  const infraRows: any[] = [];
  for (let i = 0; i < Math.min(100, PUMP_HOUSES.length); i++) {
    const ph = PUMP_HOUSES[i];
    const seed = hash(`infra-${ph.code}`);
    const si = schemeNames.indexOf(ph.scheme);
    const mapped = seed % 3 !== 0;
    infraRows.push({
      infrastructureId: `SWATI-INF-${String(i + 1).padStart(4, '0')}`,
      assetTag: `${ph.code}-P1`,
      category: 'MOTOR_PUMP',
      schemeProfileId: si >= 0 ? schemeIds[si] : schemeIds[i % schemeIds.length],
      sujalamBharatId: mapped ? `SB-INF-${7000 + i}` : null,
      externalInfraId: mapped ? `JJM-ASSET-${8000 + i}` : null,
      latitude: ph.lat,
      longitude: ph.lng,
      mappingStatus: mapped ? 'SYNCED' : 'NOT_MAPPED',
      demo: true,
    });
  }
  await prisma.infrastructureMapping.createMany({ data: infraRows });

  // A handful of generic entity mappings for the mappings endpoint.
  const emRows: any[] = [];
  for (let i = 0; i < schemeIds.length; i++) {
    emRows.push({
      entityType: 'SCHEME', internalEntityId: schemeIds[i], externalSystem: 'SUJALAM_BHARAT',
      externalEntityType: 'Scheme', externalEntityId: schemeMapped[i] ? `SB-WB-${1000 + i}` : null,
      mappingStatus: schemeMapped[i] ? 'SYNCED' : 'IN_PROGRESS',
      verificationStatus: schemeMapped[i] ? 'VERIFIED' : 'UNVERIFIED',
      mappedBy: 'demo-seed', mappedAt: schemeMapped[i] ? new Date() : null,
    });
  }
  await prisma.entityMapping.createMany({ data: emRows });

  // Mock sync history so the overview shows a last-sync line.
  await prisma.syncJob.create({
    data: {
      provider: 'JJM_1_0', direction: 'PULL', entityType: 'asset', state: 'SUCCESS',
      total: 100, success: 96, failed: 4, rejected: 0, mock: true, triggeredBy: 'demo-seed',
      notes: 'Mock legacy asset pull (retrofitting inventory).',
      startedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000), finishedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000 + 60000),
    },
  });
  await prisma.syncJob.create({
    data: {
      provider: 'SUJALAM_BHARAT', direction: 'PUSH', entityType: 'scheme', state: 'PARTIAL',
      total: 3, success: 2, failed: 0, rejected: 1, mock: true, triggeredBy: 'demo-seed',
      notes: 'Mock scheme push; 1 record pending validation.',
      startedAt: new Date(Date.now() - 3600 * 1000), finishedAt: new Date(Date.now() - 3600 * 1000 + 45000),
    },
  });

  // A JJM 1.0 legacy import batch record.
  await prisma.legacyImport.create({
    data: {
      source: 'JJM_1_0', batchLabel: 'jjm-retrofit-2024', entityType: 'asset', state: 'SUCCESS',
      total: 100, created: 60, linked: 36, skipped: 4, triggeredBy: 'demo-seed',
      notes: 'Mock import of JJM 1.0 retrofitting asset inventory.',
      startedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000), finishedAt: new Date(Date.now() - 3 * 24 * 3600 * 1000 + 120000),
    },
  });
  // Phase 2 config: declarative field mappings (SWATI field -> external field)
  // and validation rules. Demo config only; drives the mapping/validation
  // preview + report endpoints. transformArg for MAP is a JSON lookup table.
  const fmRows = [
    // --- SUJALAM_BHARAT: SCHEME ---
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SCHEME', internalField: 'schemeName', externalField: 'scheme_name', transform: 'DIRECT', required: true },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SCHEME', internalField: 'swatiSchemeId', externalField: 'source_ref', transform: 'DIRECT', required: true },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SCHEME', internalField: 'sujalamBharatId', externalField: 'external_scheme_id', transform: 'DIRECT' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SCHEME', internalField: 'schemeType', externalField: 'scheme_type', transform: 'MAP', transformArg: JSON.stringify({ PWS: 'PIPED_WATER_SUPPLY' }) },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SCHEME', internalField: 'state', externalField: 'state_name', transform: 'CONSTANT', transformArg: 'West Bengal' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SCHEME', internalField: 'district', externalField: 'district_name', transform: 'TITLECASE', required: true },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SCHEME', internalField: 'block', externalField: 'block_name', transform: 'TITLECASE' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SCHEME', internalField: 'status', externalField: 'scheme_status', transform: 'UPPERCASE' },
    // --- SUJALAM_BHARAT: SERVICE_AREA ---
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SERVICE_AREA', internalField: 'serviceAreaId', externalField: 'source_ref', transform: 'DIRECT', required: true },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SERVICE_AREA', internalField: 'name', externalField: 'service_area_name', transform: 'DIRECT', required: true },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SERVICE_AREA', internalField: 'district', externalField: 'district_name', transform: 'TITLECASE', required: true },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SERVICE_AREA', internalField: 'population', externalField: 'population', transform: 'NUMBER' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SERVICE_AREA', internalField: 'households', externalField: 'households', transform: 'NUMBER' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SERVICE_AREA', internalField: 'fhtc', externalField: 'fhtc_count', transform: 'NUMBER' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SERVICE_AREA', internalField: 'supplySource', externalField: 'water_source', transform: 'DIRECT' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SERVICE_AREA', internalField: 'serviceStatus', externalField: 'status', transform: 'UPPERCASE' },
    // --- SUJALAM_BHARAT: SUJAL_GAON ---
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SUJAL_GAON', internalField: 'swatiVillageId', externalField: 'source_ref', transform: 'DIRECT', required: true },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SUJAL_GAON', internalField: 'sujalGaonId', externalField: 'sujal_gaon_id', transform: 'DIRECT' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SUJAL_GAON', internalField: 'name', externalField: 'village_name', transform: 'DIRECT', required: true },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SUJAL_GAON', internalField: 'district', externalField: 'district_name', transform: 'TITLECASE', required: true },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SUJAL_GAON', internalField: 'population', externalField: 'population', transform: 'NUMBER' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SUJAL_GAON', internalField: 'households', externalField: 'households', transform: 'NUMBER' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SUJAL_GAON', internalField: 'fhtc', externalField: 'fhtc_count', transform: 'NUMBER' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SUJAL_GAON', internalField: 'supplyStatus', externalField: 'supply_status', transform: 'UPPERCASE' },
    // --- SUJALAM_BHARAT: INFRASTRUCTURE ---
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'INFRASTRUCTURE', internalField: 'infrastructureId', externalField: 'source_ref', transform: 'DIRECT', required: true },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'INFRASTRUCTURE', internalField: 'assetTag', externalField: 'asset_tag', transform: 'DIRECT', required: true },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'INFRASTRUCTURE', internalField: 'category', externalField: 'asset_category', transform: 'MAP', transformArg: JSON.stringify({ MOTOR_PUMP: 'PUMP' }) },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'INFRASTRUCTURE', internalField: 'sujalamBharatId', externalField: 'external_asset_id', transform: 'DIRECT' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'INFRASTRUCTURE', internalField: 'latitude', externalField: 'gps_lat', transform: 'NUMBER', required: true },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'INFRASTRUCTURE', internalField: 'longitude', externalField: 'gps_lng', transform: 'NUMBER', required: true },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'INFRASTRUCTURE', internalField: 'mappingStatus', externalField: 'status', transform: 'UPPERCASE' },
    // GIS boundaries flow as GeoJSON on the service-area / village payloads.
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SERVICE_AREA', internalField: 'gisBoundary', externalField: 'boundary_geojson', transform: 'DIRECT' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SUJAL_GAON', internalField: 'gisBoundary', externalField: 'boundary_geojson', transform: 'DIRECT' },
    // --- JJM_1_0: INFRASTRUCTURE (legacy retrofitting inventory) ---
    { externalSystem: 'JJM_1_0', entityType: 'INFRASTRUCTURE', internalField: 'infrastructureId', externalField: 'SWATI_INFRA_ID', transform: 'DIRECT', required: true },
    { externalSystem: 'JJM_1_0', entityType: 'INFRASTRUCTURE', internalField: 'assetTag', externalField: 'LEGACY_ASSET_CODE', transform: 'DIRECT' },
    { externalSystem: 'JJM_1_0', entityType: 'INFRASTRUCTURE', internalField: 'externalInfraId', externalField: 'JJM_ASSET_ID', transform: 'DIRECT', required: true },
    { externalSystem: 'JJM_1_0', entityType: 'INFRASTRUCTURE', internalField: 'category', externalField: 'ASSET_TYPE', transform: 'DIRECT' },
  ].map((r) => ({ ...r, demo: true }));
  await prisma.fieldMapping.createMany({ data: fmRows as any });

  const vrRows = [
    // Provider-agnostic structural rules (externalSystem null).
    { entityType: 'SCHEME', field: 'schemeName', ruleType: 'REQUIRED', severity: 'ERROR', message: 'Scheme name is required.' },
    { entityType: 'SCHEME', field: 'district', ruleType: 'REQUIRED', severity: 'ERROR', message: 'District is required.' },
    { entityType: 'SERVICE_AREA', field: 'name', ruleType: 'REQUIRED', severity: 'ERROR', message: 'Service area name is required.' },
    { entityType: 'SERVICE_AREA', field: 'population', ruleType: 'MIN', param: '1', severity: 'WARNING', message: 'Population should be a positive number.' },
    { entityType: 'SUJAL_GAON', field: 'swatiVillageId', ruleType: 'REQUIRED', severity: 'ERROR', message: 'SWATI village id is required.' },
    { entityType: 'SUJAL_GAON', field: 'name', ruleType: 'REQUIRED', severity: 'ERROR', message: 'Village name is required.' },
    { entityType: 'INFRASTRUCTURE', field: 'infrastructureId', ruleType: 'REQUIRED', severity: 'ERROR', message: 'Infrastructure id is required.' },
    { entityType: 'INFRASTRUCTURE', field: 'assetTag', ruleType: 'REQUIRED', severity: 'ERROR', message: 'Asset tag is required.' },
    // Sujalam Bharat provider-specific rules (mostly warnings — govt id readiness).
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SCHEME', field: 'sujalamBharatId', ruleType: 'REGEX', param: '^SB-WB-\\d+$', severity: 'WARNING', message: 'Government scheme id is missing or not in SB-WB-* format.' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SCHEME', field: 'status', ruleType: 'ENUM', param: 'ACTIVE,INACTIVE,SUSPENDED', severity: 'WARNING', message: 'Scheme status is outside the expected set.' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SERVICE_AREA', field: 'gisBoundary', ruleType: 'GIS_PRESENT', severity: 'WARNING', message: 'GIS boundary not captured for this service area.' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SUJAL_GAON', field: 'sujalamBharatId', ruleType: 'REGEX', param: '^SB-VIL-\\d+$', severity: 'WARNING', message: 'Village government id is missing or not in SB-VIL-* format.' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'SUJAL_GAON', field: 'gisBoundary', ruleType: 'GIS_PRESENT', severity: 'WARNING', message: 'GIS boundary not captured for this village.' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'INFRASTRUCTURE', field: 'sujalamBharatId', ruleType: 'REGEX', param: '^SB-INF-\\d+$', severity: 'WARNING', message: 'Asset government id is missing or not in SB-INF-* format.' },
    { externalSystem: 'SUJALAM_BHARAT', entityType: 'INFRASTRUCTURE', field: 'latitude', ruleType: 'GIS_PRESENT', severity: 'ERROR', message: 'Asset GPS location is required for government sync.' },
  ].map((r) => ({ ...r, enabled: true, demo: true }));
  await prisma.validationRule.createMany({ data: vrRows as any });

  console.log(`Seeded Sujalam Bharat integration (DEMO): ${schemeIds.length} schemes, ${serviceAreaIds.length} service areas, 25 villages, ${infraRows.length} assets, 2 mock providers, ${fmRows.length} field mappings, ${vrRows.length} validation rules.`);

  console.log('Seed complete.');
  console.log(`Admin login: ${adminEmail}`);
  console.log(`Admin password (shown once): ${adminPassword}`);
  console.log(`Tier: ${TIER}. Toggle features in the admin panel.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

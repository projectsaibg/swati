/**
 * SWATI seed — run once after `prisma migrate deploy`.
 * Compiled to dist/scripts/seed.js; run with `node dist/scripts/seed.js`.
 * Creates the deployment + feature flags (tier preset), the role ladder, an
 * admin user (prints the password ONCE), and a little demo data.
 */
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';
import { FEATURE_REGISTRY, featuresForTier, ALWAYS_ON, TierName } from '../features';
import { computeEsa } from '../esa';

const prisma = new PrismaClient();

async function main() {
  const TIER: TierName = 'VECTOR';

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
  const now = Date.now();
  const motorProfiles = [
    {
      tag: 'MTR-01', name: 'Raw water pump 1', latitude: 15.201, longitude: 74.112,
      rated: { kw: 75, v: 415, a: 130, rpm: 1480 },
      base: { voltageV: 414, currentA: 118, powerFactor: 0.9, voltageUnbalancePct: 0.8, currentUnbalancePct: 2.4, thdVoltagePct: 2.4, thdCurrentPct: 3.8, loadPct: 82, efficiencyPct: 92, speedRpm: 1478, vibrationMmS: 2.2, windingTempC: 60, bearingTempC: 54 },
    },
    {
      tag: 'MTR-02', name: 'Clear water pump 2', latitude: 15.1885, longitude: 74.098,
      rated: { kw: 55, v: 415, a: 98, rpm: 1470 },
      base: { voltageV: 410, currentA: 90, powerFactor: 0.87, voltageUnbalancePct: 2.1, currentUnbalancePct: 6.5, thdVoltagePct: 4.2, thdCurrentPct: 7.5, loadPct: 90, efficiencyPct: 86, speedRpm: 1466, vibrationMmS: 4.3, windingTempC: 70, bearingTempC: 73 },
    },
    {
      tag: 'MTR-03', name: 'Booster pump 3', latitude: 15.2205, longitude: 74.134,
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
      update: { ...ratedData, status: 'RUNNING' },
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
      latitude: 15.2035, longitude: 74.113, metric: 'flow_m3h', unit: 'm3/h', values: [128.4, 131.2, 129.7],
    },
    {
      tag: 'PS-01', name: 'Zone-3 pressure sensor', type: 'PRESSURE_SENSOR', transport: 'LORAWAN',
      gatewayId: 'LORA-GW-02', config: { devEui: '00-00-00-00-00-00-00-01', appPort: 2 },
      latitude: 15.1902, longitude: 74.101, metric: 'pressure_bar', unit: 'bar', values: [3.1, 3.0, 2.9],
    },
    {
      tag: 'WL-01', name: 'OHT-2 water level', type: 'WATER_LEVEL', transport: 'SIM',
      gatewayId: 'SIM-MODEM-03', config: { apn: 'iot.operator.net', imei: '000000000000000' },
      latitude: 15.2151, longitude: 74.127, metric: 'level_m', unit: 'm', values: [4.6, 4.4, 4.2],
    },
    {
      tag: 'CL-01', name: 'WTP chlorinator', type: 'CHLORINATOR', transport: 'RTU_MODBUS',
      gatewayId: 'RTU-GW-01', config: { unitId: 5, register: 40001 },
      latitude: 15.2088, longitude: 74.119, metric: 'residual_cl_mgl', unit: 'mg/L', values: [0.52, 0.55, 0.49],
    },
  ];
  for (const d of demoDevices) {
    const asset = await prisma.asset.upsert({
      where: { tag: d.tag },
      update: {},
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

  // Water Quality Analysers across DMAs (Sites). Each WQA is an Asset of type
  // WQ_ANALYSER linked to its DMA, with a Connectivity row and a time-series of
  // the 8 parameters via generic Measurements — the same path real RTU-modem
  // data uses, so scaling to many DMAs/analysers is adding rows, not code.
  const dmaDefs = [
    { name: 'DMA North', lat: 15.212, lng: 74.118 },
    { name: 'DMA South', lat: 15.19, lng: 74.105 },
  ];
  const dmaIds: Record<string, string> = {};
  for (const d of dmaDefs) {
    let site = await prisma.site.findFirst({ where: { name: d.name } });
    if (!site) site = await prisma.site.create({ data: { name: d.name, latitude: d.lat, longitude: d.lng } });
    dmaIds[d.name] = site.id;
  }
  const WQ_UNITS: Record<string, string> = {
    ph: '', turbidity_ntu: 'NTU', do_mgl: 'mg/L', temp_c: 'C',
    conductivity_uscm: 'uS/cm', tds_mgl: 'mg/L', hardness_mgl: 'mg/L', coliform_cfu: 'CFU/100mL',
  };
  const wqaDefs = [
    { tag: 'WQA-N1', name: 'DMA North analyser 1', dma: 'DMA North', lat: 15.213, lng: 74.119, transport: 'RTU_MODBUS', gw: 'RTU-WQ-01',
      base: { ph: 7.4, turbidity_ntu: 0.6, do_mgl: 6.6, temp_c: 26, conductivity_uscm: 420, tds_mgl: 280, hardness_mgl: 140, coliform_cfu: 0 } },
    { tag: 'WQA-N2', name: 'DMA North analyser 2', dma: 'DMA North', lat: 15.209, lng: 74.121, transport: 'MQTT', gw: 'MQTT-GW-05',
      base: { ph: 7.2, turbidity_ntu: 2.6, do_mgl: 5.8, temp_c: 29, conductivity_uscm: 640, tds_mgl: 470, hardness_mgl: 360, coliform_cfu: 0 } },
    { tag: 'WQA-S1', name: 'DMA South analyser 1', dma: 'DMA South', lat: 15.191, lng: 74.106, transport: 'SIM', gw: 'SIM-WQ-09',
      base: { ph: 5.9, turbidity_ntu: 7.4, do_mgl: 2.6, temp_c: 33, conductivity_uscm: 2500, tds_mgl: 2300, hardness_mgl: 720, coliform_cfu: 14 } },
  ];
  const WQ_STEPS = 90; // ~3h of history at 2-min spacing for a lively chart
  for (const w of wqaDefs) {
    const asset = await prisma.asset.upsert({
      where: { tag: w.tag },
      update: { siteId: dmaIds[w.dma], type: 'WQ_ANALYSER', latitude: w.lat, longitude: w.lng },
      create: { tag: w.tag, name: w.name, type: 'WQ_ANALYSER', siteId: dmaIds[w.dma], latitude: w.lat, longitude: w.lng },
    });
    await prisma.connectivity.upsert({
      where: { assetId: asset.id },
      update: { transport: w.transport as any, gatewayId: w.gw, lastSeen: new Date() },
      create: { assetId: asset.id, transport: w.transport as any, config: { gateway: w.gw } as any, gatewayId: w.gw, lastSeen: new Date() },
    });
    await prisma.measurement.deleteMany({ where: { assetId: asset.id, source: { in: ['demo', 'sim'] } } });
    const wqRows: { assetId: string; ts: Date; metric: string; value: number; unit: string; quality: string; source: string }[] = [];
    for (let step = 0; step < WQ_STEPS; step++) {
      const ts = new Date(now - (WQ_STEPS - 1 - step) * 2 * 60 * 1000); // 2-min spacing
      for (const [metric, base] of Object.entries(w.base)) {
        let value = base;
        if (metric === 'coliform_cfu') {
          value = Math.max(0, Math.round(base + Math.sin(step / 5 + base) * 1.5));
        } else {
          value = Math.round(base * (1 + 0.09 * Math.sin(step / 7 + base) + 0.03 * Math.sin(step * 1.7 + base * 2)) * 100) / 100;
        }
        wqRows.push({ assetId: asset.id, ts, metric, value, unit: WQ_UNITS[metric], quality: 'good', source: 'demo' });
      }
    }
    await prisma.measurement.createMany({ data: wqRows });
  }

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

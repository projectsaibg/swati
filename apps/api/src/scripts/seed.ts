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

  // A little demo data so screens are not empty
  const demoAssets = [
    { tag: 'MTR-01', name: 'Raw water pump 1', latitude: 15.201, longitude: 74.112, health: 94 },
    { tag: 'MTR-02', name: 'Clear water pump 2', latitude: 15.1885, longitude: 74.098, health: 82 },
    { tag: 'MTR-03', name: 'Booster pump 3', latitude: 15.2205, longitude: 74.134, health: 61 },
  ];
  for (const a of demoAssets) {
    const asset = await prisma.asset.upsert({
      where: { tag: a.tag },
      update: {},
      create: {
        tag: a.tag,
        name: a.name,
        type: 'MOTOR_PUMP',
        latitude: a.latitude,
        longitude: a.longitude,
        status: a.health < 70 ? 'FAULT' : 'RUNNING',
      },
    });
    await prisma.reading.create({
      data: {
        assetId: asset.id,
        ts: new Date(),
        efficiencyPct: 90,
        vibrationMmS: a.health < 70 ? 7.4 : 2.6,
        healthScore: a.health,
        source: 'demo',
      },
    });
    if (a.health < 70) {
      await prisma.alert.create({
        data: {
          assetId: asset.id,
          category: 'Rotor',
          severity: 'ALARM',
          message: `${a.tag}: Rotor bar health low`,
          status: 'OPEN',
        },
      });
    }
  }

  // Demo IoT sensor devices — one per new sensor family, each on a different
  // transport, with a Connectivity row and a couple of recent measurements.
  const now = Date.now();
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

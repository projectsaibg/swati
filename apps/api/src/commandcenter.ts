/**
 * Command Center — feature: command_center.
 * Aggregates the whole platform into one operational picture: system pressure &
 * flow, real-time consumption, pipe condition, asset counts, supply & demand,
 * plant/station production, active maintenance, water-main breaks, pump-station
 * status and the leak map. Real data where the platform tracks it; deterministic
 * demo for parameters a bare showcase DB does not carry. Read is public.
 *
 *  - GET /api/command-center/summary  (PUBLIC)
 */
import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Feature, Public } from './decorators';

const BAR_TO_PSI = 14.5038;
const KLH_TO_GPM = 4.40287; // kL/h -> US gallons/min
const hash = (s: string) => { let n = 0; for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0; return n; };

@Injectable()
export class CommandCenterService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const now = Date.now();

    // --- instrument assets for pressure / flow ----------------------------
    const [flowAssets, presAssets] = await Promise.all([
      this.prisma.asset.findMany({ where: { type: 'FLOW_METER' }, select: { id: true } }),
      this.prisma.asset.findMany({ where: { type: 'PRESSURE_SENSOR' }, select: { id: true } }),
    ]);
    const flowIds = flowAssets.map((a) => a.id);
    const presIds = presAssets.map((a) => a.id);

    const since = new Date(now - 3 * 60 * 60 * 1000);
    const meas = await this.prisma.measurement.findMany({
      where: { assetId: { in: [...flowIds, ...presIds] }, metric: { in: ['net_flow_klh', 'pressure_bar'] }, ts: { gte: since } },
      orderBy: { ts: 'desc' }, take: 40000, select: { assetId: true, metric: true, value: true, ts: true },
    });
    // latest per asset|metric + time buckets for consumption
    const latest = new Map<string, number>();
    const flowByBucket = new Map<number, number>();
    const BUCKET = 15 * 60 * 1000; // 15-min buckets
    for (const r of meas) {
      const k = `${r.assetId}|${r.metric}`;
      if (!latest.has(k)) latest.set(k, Number(r.value));
      if (r.metric === 'net_flow_klh') {
        const b = Math.floor(new Date(r.ts).getTime() / BUCKET);
        flowByBucket.set(b, (flowByBucket.get(b) ?? 0) + Number(r.value));
      }
    }
    let flowSum = 0;
    for (const id of flowIds) { const v = latest.get(`${id}|net_flow_klh`); if (v != null) flowSum += v; }
    let presSum = 0, presN = 0;
    for (const id of presIds) { const v = latest.get(`${id}|pressure_bar`); if (v != null) { presSum += v; presN++; } }
    const gpm = Math.round(flowSum * KLH_TO_GPM);
    const psi = presN ? Math.round((presSum / presN) * BAR_TO_PSI) : 0;

    const consumption = [...flowByBucket.keys()].sort((a, b) => a - b).slice(-9).map((k) => ({
      label: new Date(k * BUCKET).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      value: Math.round(flowByBucket.get(k)! * KLH_TO_GPM),
    }));

    // --- network pipe condition -------------------------------------------
    // Pipe condition is a distribution over the distribution network, which a
    // bare showcase DB does not instrument, so this is a representative spread.
    const pipeCondition = { good: 75, fair: 18, poor: 5, critical: 2, overallHealth: 88 };

    // --- asset counts -----------------------------------------------------
    const [pumpStationCount, valveCount, billLatest] = await Promise.all([
      this.prisma.site.count({ where: { kind: 'PUMP_STATION' } }),
      this.prisma.valve.count(),
      this.prisma.billingRecord.findMany({ orderBy: { period: 'desc' }, take: 1, select: { period: true } }),
    ]);
    let customers = 0;
    if (billLatest[0]) {
      const cur = await this.prisma.billingRecord.aggregate({ where: { period: billLatest[0].period }, _sum: { connections: true } });
      customers = cur._sum.connections ?? 0;
    }
    const assets = {
      treatmentPlants: 6,
      pumpStations: pumpStationCount,
      valves: valveCount,
      customers,
      networkMiles: 4120,
    };

    // --- supply & demand --------------------------------------------------
    const supplyDemand = {
      supplyPsi: psi,
      totalDemandGpm: gpm,
      systemDemandGpm: Math.round(gpm * 0.96),
      supplyReserveMld: Math.round((flowSum * 24) / 1000 * 10) / 10, // kL/h -> MLD
    };

    // --- plant & station: 7-day production / leakage / WAMR / AMI ----------
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) days.push(new Date(now - i * 86400000).toLocaleDateString([], { month: '2-digit', day: '2-digit' }));
    const plantStation = days.map((label, i) => {
      const seed = hash(label + i);
      // production/wamr/ami as MGD-scale bars (left axis); leakage as % (right axis).
      return { label, production: 250 + (seed % 90), leakage: 12 + (seed % 11), wamr: 150 + (seed % 110), ami: 120 + (seed % 120) };
    });

    // --- active maintenance (open work orders) ----------------------------
    const woRows = await this.prisma.workOrder.findMany({
      where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      orderBy: [{ priority: 'asc' }, { dueAt: 'asc' }], take: 8,
      select: { code: true, title: true, siteName: true, priority: true, dueAt: true },
    });
    const maintenance = woRows.map((w) => ({
      code: w.code, title: w.title, site: w.siteName, priority: w.priority,
      due: w.dueAt ? new Date(w.dueAt).toLocaleDateString() : null,
    }));

    // --- water main breaks (last ~11 periods) -----------------------------
    const waterMainBreaks = Array.from({ length: 11 }, (_, i) => {
      const seed = hash('wmb' + i);
      return { label: new Date(now - (10 - i) * 3 * 86400000).toLocaleDateString([], { month: '2-digit', day: '2-digit' }), breaks: 20 + (seed % 170), prev: 20 + ((seed >> 3) % 150) };
    });

    // --- pump-station status timeline -------------------------------------
    const stations = await this.prisma.site.findMany({
      where: { kind: 'PUMP_STATION' }, orderBy: { name: 'asc' }, take: 6,
      select: { name: true, code: true, assets: { where: { type: 'MOTOR_PUMP' }, select: { status: true } } },
    });
    const pumpStatus = stations.map((s) => {
      const seed = hash(s.code ?? s.name);
      const faulted = s.assets.some((a) => a.status === 'FAULT');
      const cells = Array.from({ length: 14 }, (_, i) => (faulted && i > 9 ? 0 : (((seed >> i) & 1) || i % 3 !== 0 ? 1 : 0)));
      return { name: s.name.split(' — ')[0].slice(0, 22), cells };
    });

    // --- leak points for the mini map -------------------------------------
    const leakSites = await this.prisma.site.findMany({
      where: { kind: 'PUMP_STATION' }, orderBy: { name: 'asc' }, take: 400,
      select: { latitude: true, longitude: true, code: true },
    });
    const leaks = leakSites
      .map((s) => ({ lat: s.latitude ? Number(s.latitude) : null, lng: s.longitude ? Number(s.longitude) : null, sev: hash(s.code ?? '') % 100 }))
      .filter((p) => p.lat != null && p.lng != null && p.sev >= 82)
      .slice(0, 12)
      .map((p) => ({ lat: p.lat as number, lng: p.lng as number, severity: p.sev >= 92 ? 'High' : 'Medium' }));

    return {
      pressure: { psi, gpm },
      consumption,
      pipeCondition,
      assets,
      supplyDemand,
      plantStation,
      maintenance,
      waterMainBreaks,
      pumpStatus,
      leaks,
      updatedAt: new Date().toISOString(),
    };
  }
}

@Controller('command-center')
export class CommandCenterController {
  constructor(private readonly svc: CommandCenterService) {}

  @Public() @Feature('command_center') @Get('summary')
  summary() { return this.svc.summary(); }
}

@Module({
  providers: [CommandCenterService],
  controllers: [CommandCenterController],
  exports: [CommandCenterService],
})
export class CommandCenterModule {}

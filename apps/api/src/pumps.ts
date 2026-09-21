/**
 * Pump Stations (pump houses) — feature: pump_stations (VECTOR, PUBLIC).
 *
 * A pump house is a Site(kind=PUMP_STATION) containing pump Assets plus its
 * station sensors modelled as devices (WATER_LEVEL tank, PRESSURE_SENSOR,
 * FLOW_METER). Pumps run on a duty rotation so each rests; a per-pump
 * `run_state` (1/0) Measurement time-series drives the run/stop timeline and
 * duty-cycle %. Adding stations/pumps is data, not code.
 *
 *   - GET /api/pump-stations           — every station with whole-house KPIs
 *   - GET /api/pump-stations/:id        — station KPIs + pumps + timelines + charts
 */
import { Controller, Get, Injectable, Module, NotFoundException, Param } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Feature, Public } from './decorators';

const PUMP_TYPES = ['MOTOR_PUMP', 'PUMP', 'MOTOR'];
const WINDOW_MS = 6 * 60 * 60 * 1000;

type PumpState = 'RUN' | 'REST' | 'TRIP';

@Injectable()
export class PumpStationsService {
  constructor(private readonly prisma: PrismaService) {}

  private async latest(assetIds: string[], metrics: string[]) {
    if (assetIds.length === 0) return new Map<string, number>();
    const rows = await this.prisma.measurement.findMany({
      where: { assetId: { in: assetIds }, metric: { in: metrics } },
      orderBy: { ts: 'desc' }, take: 12000,
    });
    const map = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.assetId}|${r.metric}`;
      if (!map.has(k)) map.set(k, Number(r.value));
    }
    return map;
  }

  private stationDevices(assets: { id: string; type: string }[]) {
    return {
      tank: assets.find((a) => a.type === 'WATER_LEVEL')?.id ?? null,
      pressure: assets.find((a) => a.type === 'PRESSURE_SENSOR')?.id ?? null,
      flow: assets.find((a) => a.type === 'FLOW_METER')?.id ?? null,
    };
  }

  async list() {
    const stations = await this.prisma.site.findMany({
      where: { kind: 'PUMP_STATION' },
      orderBy: { name: 'asc' },
      include: { assets: { select: { id: true, type: true, status: true } } },
    });
    // Batch the latest-value lookup across every station's devices in one
    // query — avoids an N+1 that would fire one query per pump house at scale.
    const allDevIds: string[] = [];
    for (const s of stations) {
      const dev = this.stationDevices(s.assets);
      for (const id of [dev.tank, dev.pressure, dev.flow]) if (id) allDevIds.push(id);
    }
    const lm = await this.latest(allDevIds, ['storage_m3', 'level_pct', 'pressure_bar', 'net_flow_klh']);
    return stations.map((s) => {
      const pumps = s.assets.filter((a) => PUMP_TYPES.includes(a.type));
      const dev = this.stationDevices(s.assets);
      return {
        id: s.id, name: s.name,
        pumpCount: pumps.length,
        running: pumps.filter((p) => p.status === 'RUNNING').length,
        tripped: pumps.filter((p) => p.status === 'FAULT').length,
        storageM3: dev.tank ? lm.get(`${dev.tank}|storage_m3`) ?? null : null,
        levelPct: dev.tank ? lm.get(`${dev.tank}|level_pct`) ?? null : null,
        pressureBar: dev.pressure ? lm.get(`${dev.pressure}|pressure_bar`) ?? null : null,
        netFlowKlh: dev.flow ? lm.get(`${dev.flow}|net_flow_klh`) ?? null : null,
      };
    });
  }

  async detail(id: string) {
    const s = await this.prisma.site.findUnique({
      where: { id },
      include: { assets: { select: { id: true, tag: true, name: true, type: true, status: true } } },
    });
    if (!s || s.kind !== 'PUMP_STATION') throw new NotFoundException('Pump station not found');

    const pumps = s.assets.filter((a) => PUMP_TYPES.includes(a.type));
    const dev = this.stationDevices(s.assets);
    const pumpIds = pumps.map((p) => p.id);
    const devIds = [dev.tank, dev.pressure, dev.flow].filter(Boolean) as string[];
    const since = new Date(Date.now() - WINDOW_MS);

    const [devLatest, pumpRows, esaRows] = await Promise.all([
      this.latest(devIds, ['storage_m3', 'level_pct', 'pressure_bar', 'net_flow_klh']),
      this.prisma.measurement.findMany({
        where: { assetId: { in: pumpIds.length ? pumpIds : ['none'] }, metric: { in: ['run_state', 'power_kw', 'flow_klh'] }, ts: { gte: since } },
        orderBy: { ts: 'asc' },
      }),
      this.prisma.reading.findMany({
        where: { assetId: { in: pumpIds.length ? pumpIds : ['none'] } },
        orderBy: { ts: 'desc' }, take: 200, select: { assetId: true, healthScore: true, ts: true },
      }),
    ]);

    const healthByPump = new Map<string, number>();
    for (const r of esaRows) if (!healthByPump.has(r.assetId) && r.healthScore != null) healthByPump.set(r.assetId, Number(r.healthScore));

    // Per-pump: run timeline, duty %, runtime, latest power/flow, state.
    const pumpsOut = pumps.map((p) => {
      const rs = pumpRows.filter((r) => r.assetId === p.id && r.metric === 'run_state');
      const timeline = rs.map((r) => ({ ts: r.ts, on: Number(r.value) >= 0.5 }));
      const onCount = timeline.filter((t) => t.on).length;
      const dutyPct = timeline.length ? Math.round((onCount / timeline.length) * 100) : 0;
      const latestOn = timeline.length ? timeline[timeline.length - 1].on : false;
      const powerSeries = pumpRows.filter((r) => r.assetId === p.id && r.metric === 'power_kw');
      const flowSeries = pumpRows.filter((r) => r.assetId === p.id && r.metric === 'flow_klh');
      const latestPower = powerSeries.length ? Number(powerSeries[powerSeries.length - 1].value) : null;
      const latestFlow = flowSeries.length ? Number(flowSeries[flowSeries.length - 1].value) : null;
      const state: PumpState = p.status === 'FAULT' ? 'TRIP' : latestOn ? 'RUN' : 'REST';
      const spanH = timeline.length > 1 ? (new Date(timeline[timeline.length - 1].ts).getTime() - new Date(timeline[0].ts).getTime()) / 3600000 : 0;
      const runtimeH = Math.round((dutyPct / 100) * spanH * 10) / 10;
      return {
        id: p.id, tag: p.tag, name: p.name, state,
        health: healthByPump.get(p.id) ?? null,
        dutyPct, runtimeH,
        powerKw: latestPower, flowKlh: latestFlow,
        timeline,
        powerTrend: powerSeries.map((r) => ({ ts: r.ts, value: Number(r.value) })),
      };
    });

    // Station charts.
    const flowSeries = dev.flow
      ? (await this.prisma.measurement.findMany({
          where: { assetId: dev.flow, metric: 'net_flow_klh', ts: { gte: since } }, orderBy: { ts: 'asc' },
        })).map((r) => ({ ts: r.ts, value: Number(r.value) }))
      : [];
    // total energy over time: sum power_kw across pumps per 5-min bucket
    const bucketMs = 5 * 60 * 1000;
    const energyBuckets = new Map<number, number>();
    for (const r of pumpRows) {
      if (r.metric !== 'power_kw') continue;
      const b = Math.floor(new Date(r.ts).getTime() / bucketMs);
      energyBuckets.set(b, (energyBuckets.get(b) ?? 0) + Number(r.value));
    }
    const energy = [...energyBuckets.keys()].sort((a, b) => a - b).map((k) => ({
      ts: new Date(k * bucketMs).toISOString(), value: Math.round(energyBuckets.get(k)! * 10) / 10,
    }));
    const tankSeries = dev.tank
      ? (await this.prisma.measurement.findMany({
          where: { assetId: dev.tank, metric: 'level_pct', ts: { gte: since } }, orderBy: { ts: 'asc' },
        })).map((r) => ({ ts: r.ts, value: Number(r.value) }))
      : [];

    return {
      id: s.id, name: s.name,
      kpis: {
        storageM3: dev.tank ? devLatest.get(`${dev.tank}|storage_m3`) ?? null : null,
        levelPct: dev.tank ? devLatest.get(`${dev.tank}|level_pct`) ?? null : null,
        pressureBar: dev.pressure ? devLatest.get(`${dev.pressure}|pressure_bar`) ?? null : null,
        netFlowKlh: dev.flow ? devLatest.get(`${dev.flow}|net_flow_klh`) ?? null : null,
        running: pumpsOut.filter((p) => p.state === 'RUN').length,
        resting: pumpsOut.filter((p) => p.state === 'REST').length,
        tripped: pumpsOut.filter((p) => p.state === 'TRIP').length,
        totalPowerKw: Math.round(pumpsOut.reduce((a, p) => a + (p.powerKw ?? 0), 0) * 10) / 10,
      },
      pumps: pumpsOut,
      charts: { flow: flowSeries, energy, tank: tankSeries },
    };
  }
}

@Controller('pump-stations')
export class PumpStationsController {
  constructor(private readonly svc: PumpStationsService) {}

  @Public() @Feature('pump_stations') @Get()
  list() { return this.svc.list(); }

  @Public() @Feature('pump_stations') @Get(':id')
  detail(@Param('id') id: string) { return this.svc.detail(id); }
}

@Module({
  providers: [PumpStationsService],
  controllers: [PumpStationsController],
  exports: [PumpStationsService],
})
export class PumpStationsModule {}

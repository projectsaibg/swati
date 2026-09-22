/**
 * Field Instruments — feature: instrumentation (VECTOR).
 * The primary water-monitoring assets of a smart water system: flow meters,
 * level transmitters, pressure transmitters, chlorinators and water-quality
 * analysers. Lists each instrument with its latest reading, connectivity and
 * online/offline state, filterable by District -> Block -> Zone. Read is public.
 *
 *  - GET /api/instruments/summary  (PUBLIC) — counts by type + online/offline
 *  - GET /api/instruments/list     (PUBLIC) — instruments + latest reading
 */
import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Feature, Public } from './decorators';

type Geo = { district?: string; block?: string; zone?: string };
const TYPES = ['FLOW_METER', 'WATER_LEVEL', 'PRESSURE_SENSOR', 'CHLORINATOR', 'WQ_ANALYSER'];
const TYPE_LABEL: Record<string, string> = {
  FLOW_METER: 'Flow Meter', WATER_LEVEL: 'Level Transmitter', PRESSURE_SENSOR: 'Pressure Transmitter',
  CHLORINATOR: 'Chlorinator', WQ_ANALYSER: 'Water Quality Analyser',
};
// Primary reading per type (first candidate the asset actually has wins).
const PRIMARY: Record<string, { metric: string; unit: string }[]> = {
  FLOW_METER: [{ metric: 'net_flow_klh', unit: 'kL/h' }, { metric: 'flow_m3h', unit: 'm³/h' }],
  WATER_LEVEL: [{ metric: 'level_pct', unit: '%' }, { metric: 'level_m', unit: 'm' }],
  PRESSURE_SENSOR: [{ metric: 'pressure_bar', unit: 'bar' }],
  CHLORINATOR: [{ metric: 'residual_cl_mgl', unit: 'mg/L' }],
  WQ_ANALYSER: [{ metric: 'ph', unit: 'pH' }],
};
const ALL_METRICS = [...new Set(Object.values(PRIMARY).flat().map((m) => m.metric))];
const ONLINE_MS = 30 * 60 * 1000;

function siteWhere(f?: Geo) {
  const sw: any = {};
  if (f?.district) sw.district = f.district;
  if (f?.block) sw.block = f.block;
  if (f?.zone) sw.zone = f.zone;
  return Object.keys(sw).length ? { site: sw } : {};
}

@Injectable()
export class InstrumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(f?: Geo) {
    const assets = await this.prisma.asset.findMany({
      where: { type: { in: TYPES as any }, ...siteWhere(f) },
      select: { type: true, connectivity: { select: { lastSeen: true } } },
    });
    const now = Date.now();
    const byType: Record<string, number> = {};
    for (const t of TYPES) byType[t] = 0;
    let online = 0;
    for (const a of assets) {
      byType[a.type] = (byType[a.type] ?? 0) + 1;
      if (a.connectivity?.lastSeen && now - new Date(a.connectivity.lastSeen).getTime() < ONLINE_MS) online++;
    }
    return { total: assets.length, byType, online, offline: assets.length - online };
  }

  async list(f?: Geo, type?: string) {
    const typeWhere = type && TYPES.includes(type) ? type : { in: TYPES };
    const assets = await this.prisma.asset.findMany({
      where: { type: typeWhere as any, ...siteWhere(f) },
      orderBy: { tag: 'asc' },
      include: {
        site: { select: { name: true, district: true, block: true, zone: true } },
        connectivity: { select: { transport: true, lastSeen: true } },
      },
    });
    const ids = assets.map((a) => a.id);
    const rows = ids.length
      ? await this.prisma.measurement.findMany({
          where: { assetId: { in: ids }, metric: { in: ALL_METRICS } },
          orderBy: { ts: 'desc' }, take: 30000, select: { assetId: true, metric: true, value: true, unit: true, ts: true },
        })
      : [];
    const latest = new Map<string, { value: number; unit: string | null; ts: Date }>();
    for (const r of rows) {
      const k = `${r.assetId}|${r.metric}`;
      if (!latest.has(k)) latest.set(k, { value: Number(r.value), unit: r.unit, ts: r.ts });
    }
    const now = Date.now();
    return assets.map((a) => {
      let value: number | null = null, unit = '', metric: string | null = null, ts: Date | null = null;
      for (const c of PRIMARY[a.type] ?? []) {
        const hit = latest.get(`${a.id}|${c.metric}`);
        if (hit) { value = hit.value; unit = c.unit || hit.unit || ''; metric = c.metric; ts = hit.ts; break; }
      }
      const online = a.connectivity?.lastSeen ? now - new Date(a.connectivity.lastSeen).getTime() < ONLINE_MS : false;
      return {
        id: a.id, tag: a.tag, name: a.name, type: a.type, typeLabel: TYPE_LABEL[a.type] ?? a.type,
        siteName: a.site?.name ?? null, district: a.site?.district ?? null, block: a.site?.block ?? null, zone: a.site?.zone ?? null,
        transport: a.connectivity?.transport ?? null, lastSeen: a.connectivity?.lastSeen ?? null, online,
        value, unit, metric, ts,
      };
    });
  }
}

@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly svc: InstrumentsService) {}

  @Public() @Feature('instrumentation') @Get('summary')
  summary(@Query('district') district?: string, @Query('block') block?: string, @Query('zone') zone?: string) {
    return this.svc.summary({ district, block, zone });
  }

  @Public() @Feature('instrumentation') @Get('list')
  list(@Query('district') district?: string, @Query('block') block?: string, @Query('zone') zone?: string, @Query('type') type?: string) {
    return this.svc.list({ district, block, zone }, type);
  }
}

@Module({
  providers: [InstrumentsService],
  controllers: [InstrumentsController],
  exports: [InstrumentsService],
})
export class InstrumentsModule {}

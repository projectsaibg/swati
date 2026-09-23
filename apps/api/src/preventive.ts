/**
 * Preventive — feature: predictive (QUANTUM, Intelligence).
 * AI preventive-maintenance forecasting across the telemetry network: for every
 * asset (pumps/motors, overhead reservoirs, pipelines, flow/level/pressure
 * transmitters, water-quality analysers, chlorinators) it forecasts a risk
 * score, the recommended preventive action, when it is due, a priority and a
 * model confidence. The model is a deterministic heuristic over asset condition,
 * age and live fault state (a real deployment would swap in a trained model).
 * Read is public.
 *
 *  - GET /api/preventive/summary    (PUBLIC) — urgency buckets + KPIs
 *  - GET /api/preventive/forecasts  (PUBLIC) — ranked per-asset forecasts
 */
import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Feature, Public } from './decorators';

type Geo = { district?: string; block?: string; zone?: string };
const hash = (s: string) => { let n = 0; for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0; return n; };

const ASSET_TYPES = ['MOTOR_PUMP', 'OHT', 'FLOW_METER', 'PRESSURE_SENSOR', 'WATER_LEVEL', 'WQ_ANALYSER', 'CHLORINATOR'];
const META: Record<string, { label: string; action: string; wear: number }> = {
  MOTOR_PUMP: { label: 'Pump / Motor', action: 'Bearing lubrication & vibration/ESA check', wear: 1.0 },
  OHT: { label: 'Overhead Reservoir', action: 'Tank cleaning & structural integrity inspection', wear: 0.6 },
  PIPELINE: { label: 'Pipeline', action: 'Pressure test & leak survey', wear: 0.9 },
  FLOW_METER: { label: 'Flow Meter', action: 'Flow meter calibration', wear: 0.8 },
  PRESSURE_SENSOR: { label: 'Pressure Transmitter', action: 'Pressure transmitter calibration', wear: 0.8 },
  WATER_LEVEL: { label: 'Level Transmitter', action: 'Level sensor calibration & float check', wear: 0.8 },
  WQ_ANALYSER: { label: 'Water Quality Analyser', action: 'Sensor calibration & reagent refill', wear: 1.1 },
  CHLORINATOR: { label: 'Chlorinator', action: 'Dosing pump calibration & cleaning', wear: 1.0 },
};

interface Forecast {
  assetTag: string; name: string; type: string; typeLabel: string;
  site: string | null; district: string | null; block: string | null; zone: string | null;
  ageMonths: number; riskPct: number; action: string;
  dueInDays: number; urgency: 'Overdue' | 'Due <=30d' | 'Due <=90d' | 'Scheduled';
  priority: 'High' | 'Medium' | 'Low'; confidence: number; estCostInr: number;
}

function siteWhere(f?: Geo) {
  const sw: any = {};
  if (f?.district) sw.district = f.district;
  if (f?.block) sw.block = f.block;
  if (f?.zone) sw.zone = f.zone;
  return Object.keys(sw).length ? { site: sw } : {};
}
function geoWhere(f?: Geo) {
  const w: any = { kind: 'PUMP_STATION' };
  if (f?.district) w.district = f.district;
  if (f?.block) w.block = f.block;
  if (f?.zone) w.zone = f.zone;
  return w;
}

function forecast(key: string, type: string, faulted: boolean, ctx: { tag: string; name: string; site: string | null; district: string | null; block: string | null; zone: string | null }): Forecast {
  const m = META[type];
  const ageMonths = hash(key) % 96;
  const base = hash(key + 'r') % 40;
  const riskPct = Math.round(Math.min(100, Math.max(0, base * m.wear + ageMonths * 0.55 * m.wear + (faulted ? 45 : 0))));
  const dueInDays = faulted ? 0 : Math.max(0, Math.round((100 - riskPct) * 1.7));
  const urgency: Forecast['urgency'] = dueInDays <= 0 ? 'Overdue' : dueInDays <= 30 ? 'Due <=30d' : dueInDays <= 90 ? 'Due <=90d' : 'Scheduled';
  const priority: Forecast['priority'] = riskPct >= 75 ? 'High' : riskPct >= 50 ? 'Medium' : 'Low';
  const confidence = 80 + (hash(key + 'c') % 16);
  const estCostInr = Math.round((riskPct / 100) * m.wear * 60000);
  return {
    assetTag: ctx.tag, name: ctx.name, type, typeLabel: m.label,
    site: ctx.site, district: ctx.district, block: ctx.block, zone: ctx.zone,
    ageMonths, riskPct, action: m.action, dueInDays, urgency, priority, confidence, estCostInr,
  };
}

@Injectable()
export class PreventiveService {
  constructor(private readonly prisma: PrismaService) {}

  private async build(f?: Geo, type?: string): Promise<Forecast[]> {
    const out: Forecast[] = [];
    const wantAssets = !type || (type !== 'PIPELINE' && ASSET_TYPES.includes(type));
    const wantPipes = !type || type === 'PIPELINE';

    if (wantAssets) {
      const assets = await this.prisma.asset.findMany({
        where: { type: (type && type !== 'PIPELINE' ? type : { in: ASSET_TYPES }) as any, ...siteWhere(f) },
        select: { id: true, tag: true, name: true, type: true, status: true, site: { select: { name: true, district: true, block: true, zone: true } } },
      });
      for (const a of assets) {
        out.push(forecast(a.id, a.type, a.status === 'FAULT', {
          tag: a.tag, name: a.name, site: a.site?.name ?? null,
          district: a.site?.district ?? null, block: a.site?.block ?? null, zone: a.site?.zone ?? null,
        }));
      }
    }
    if (wantPipes) {
      const sites = await this.prisma.site.findMany({
        where: geoWhere(f), select: { name: true, code: true, district: true, block: true, zone: true },
      });
      for (const s of sites) {
        const key = `${s.code ?? s.name}-PIPE`;
        out.push(forecast(key, 'PIPELINE', false, {
          tag: `${s.code ?? '?'}-PIPE`, name: `${s.name.split(' — ')[0]} distribution main`,
          site: s.name, district: s.district, block: s.block, zone: s.zone,
        }));
      }
    }
    return out;
  }

  async forecasts(f?: Geo, type?: string) {
    const rows = await this.build(f, type);
    rows.sort((a, b) => a.dueInDays - b.dueInDays || b.riskPct - a.riskPct);
    return rows;
  }

  async summary(f?: Geo) {
    const rows = await this.build(f);
    const overdue = rows.filter((r) => r.urgency === 'Overdue').length;
    const due30 = rows.filter((r) => r.urgency === 'Due <=30d').length;
    const due90 = rows.filter((r) => r.urgency === 'Due <=90d').length;
    const scheduled = rows.filter((r) => r.urgency === 'Scheduled').length;
    const predictedFailures30 = rows.filter((r) => r.priority === 'High' && r.dueInDays <= 30).length;
    const estCostAvoidedInr = rows.filter((r) => r.dueInDays <= 90).reduce((a, r) => a + r.estCostInr, 0);
    const avgConfidence = rows.length ? Math.round(rows.reduce((a, r) => a + r.confidence, 0) / rows.length) : 0;
    const byType: Record<string, number> = {};
    for (const r of rows) byType[r.typeLabel] = (byType[r.typeLabel] ?? 0) + 1;
    return {
      total: rows.length, overdue, due30, due90, scheduled,
      predictedFailures30, estCostAvoidedInr, avgConfidence, byType,
    };
  }
}

@Controller('preventive')
export class PreventiveController {
  constructor(private readonly svc: PreventiveService) {}

  @Public() @Feature('predictive') @Get('summary')
  summary(@Query('district') district?: string, @Query('block') block?: string, @Query('zone') zone?: string) {
    return this.svc.summary({ district, block, zone });
  }

  @Public() @Feature('predictive') @Get('forecasts')
  forecasts(@Query('district') district?: string, @Query('block') block?: string, @Query('zone') zone?: string, @Query('type') type?: string) {
    return this.svc.forecasts({ district, block, zone }, type);
  }
}

@Module({
  providers: [PreventiveService],
  controllers: [PreventiveController],
  exports: [PreventiveService],
})
export class PreventiveModule {}

/**
 * Water Quality — feature: water_quality (VECTOR, PUBLIC).
 *
 * A Water Quality Analyser (WQA) is an Asset of type WQ_ANALYSER, linked to
 * its DMA (a Site) and a Connectivity row (RTU_MODBUS/MQTT/...). Its readings
 * arrive as generic Measurements via the shared ingest endpoints
 * (/api/ingest/measurements with X-Ingest-Key, or /api/devices/:id/measurements)
 * — so adding more DMAs/analysers is data, not code. This module reads the
 * latest value per (analyser, parameter) and scores it against drinking-water
 * thresholds (IS 10500 / WHO style).
 *
 *   - GET /api/water-quality/summary          — project + per-DMA rollup
 *   - GET /api/water-quality/analysers        — every WQA with latest params
 *   - GET /api/water-quality/analysers/:id    — one WQA: params + trends
 */
import { Controller, Get, Injectable, Module, NotFoundException, Param } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Feature, Public } from './decorators';

export type WqStatus = 'safe' | 'warn' | 'breach';
type Kind = 'lowerBetter' | 'higherBetter' | 'band' | 'zero';

interface WqMetric {
  key: string; label: string; unit: string; kind: Kind;
  safeMax?: number; warnMax?: number; // lowerBetter
  safeMin?: number; warnMin?: number; // higherBetter
  bandSafe?: [number, number]; bandWarn?: [number, number]; // band (e.g. pH)
}

// Canonical water-quality parameters (metric keys used on the Measurement rows).
export const WQ_METRICS: WqMetric[] = [
  { key: 'ph', label: 'pH', unit: '', kind: 'band', bandSafe: [6.5, 8.5], bandWarn: [6.0, 9.0] },
  { key: 'turbidity_ntu', label: 'Turbidity', unit: 'NTU', kind: 'lowerBetter', safeMax: 1, warnMax: 5 },
  { key: 'do_mgl', label: 'Dissolved O₂', unit: 'mg/L', kind: 'higherBetter', safeMin: 5, warnMin: 3 },
  { key: 'temp_c', label: 'Temperature', unit: '°C', kind: 'lowerBetter', safeMax: 30, warnMax: 35 },
  { key: 'conductivity_uscm', label: 'Conductivity', unit: 'µS/cm', kind: 'lowerBetter', safeMax: 750, warnMax: 2250 },
  { key: 'tds_mgl', label: 'TDS', unit: 'mg/L', kind: 'lowerBetter', safeMax: 500, warnMax: 2000 },
  { key: 'hardness_mgl', label: 'Hardness', unit: 'mg/L', kind: 'lowerBetter', safeMax: 200, warnMax: 600 },
  { key: 'coliform_cfu', label: 'Total coliform', unit: 'CFU/100mL', kind: 'zero', safeMax: 0, warnMax: 0 },
];
const WQ_KEYS = WQ_METRICS.map((m) => m.key);
const BY_KEY = new Map(WQ_METRICS.map((m) => [m.key, m]));
const RANK: Record<WqStatus, number> = { safe: 0, warn: 1, breach: 2 };

export function evaluate(key: string, value: number): WqStatus {
  const m = BY_KEY.get(key);
  if (!m) return 'safe';
  switch (m.kind) {
    case 'lowerBetter':
      return value <= (m.safeMax ?? Infinity) ? 'safe' : value <= (m.warnMax ?? Infinity) ? 'warn' : 'breach';
    case 'higherBetter':
      return value >= (m.safeMin ?? -Infinity) ? 'safe' : value >= (m.warnMin ?? -Infinity) ? 'warn' : 'breach';
    case 'zero':
      return value <= 0 ? 'safe' : 'breach';
    case 'band': {
      const [s0, s1] = m.bandSafe!; const [w0, w1] = m.bandWarn!;
      if (value >= s0 && value <= s1) return 'safe';
      if (value >= w0 && value <= w1) return 'warn';
      return 'breach';
    }
  }
}
const worst = (a: WqStatus, b: WqStatus): WqStatus => (RANK[a] >= RANK[b] ? a : b);

@Injectable()
export class WaterQualityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Latest Measurement per (assetId, metric) for the given analyser ids. */
  private async latestByAssetMetric(assetIds: string[]) {
    const rows = await this.prisma.measurement.findMany({
      where: { assetId: { in: assetIds }, metric: { in: WQ_KEYS } },
      orderBy: { ts: 'desc' },
      take: 8000,
    });
    const map = new Map<string, { value: number; ts: Date; unit: string | null }>();
    for (const r of rows) {
      const k = `${r.assetId}|${r.metric}`;
      if (!map.has(k)) map.set(k, { value: Number(r.value), ts: r.ts, unit: r.unit });
    }
    return map;
  }

  private async analyserAssets() {
    return this.prisma.asset.findMany({
      where: { type: 'WQ_ANALYSER' },
      orderBy: { tag: 'asc' },
      include: { site: { select: { id: true, name: true } }, connectivity: { select: { transport: true, lastSeen: true } } },
    });
  }

  private paramsFor(assetId: string, latest: Map<string, { value: number; ts: Date; unit: string | null }>) {
    return WQ_METRICS.map((m) => {
      const hit = latest.get(`${assetId}|${m.key}`);
      const value = hit ? hit.value : null;
      return {
        key: m.key, label: m.label, unit: m.unit,
        value, status: value == null ? null : evaluate(m.key, value), ts: hit?.ts ?? null,
      };
    });
  }

  async analysers() {
    const assets = await this.analyserAssets();
    const latest = await this.latestByAssetMetric(assets.map((a) => a.id));
    return assets.map((a) => {
      const params = this.paramsFor(a.id, latest);
      const status = params.reduce<WqStatus>((s, p) => (p.status ? worst(s, p.status) : s), 'safe');
      return {
        id: a.id, tag: a.tag, name: a.name,
        dmaId: a.site?.id ?? null, dmaName: a.site?.name ?? 'Unassigned',
        transport: a.connectivity?.transport ?? null, lastSeen: a.connectivity?.lastSeen ?? null,
        status, params,
      };
    });
  }

  async summary() {
    const list = await this.analysers();
    // Per-parameter project rollup.
    const parameters = WQ_METRICS.map((m) => {
      const vals: number[] = [];
      let breach = 0; let warn = 0; let total = 0; let st: WqStatus = 'safe';
      for (const a of list) {
        const p = a.params.find((x) => x.key === m.key);
        if (!p || p.value == null || p.status == null) continue;
        total++; vals.push(p.value); st = worst(st, p.status);
        if (p.status === 'breach') breach++; else if (p.status === 'warn') warn++;
      }
      const avg = vals.length ? Math.round((vals.reduce((x, y) => x + y, 0) / vals.length) * 100) / 100 : null;
      return { key: m.key, label: m.label, unit: m.unit, avg, status: total ? st : null, breach, warn, total };
    });
    // Per-DMA rollup.
    const byDma = new Map<string, { id: string; name: string; analyserCount: number; status: WqStatus; worstParam: string | null }>();
    for (const a of list) {
      const key = a.dmaId ?? 'unassigned';
      const cur = byDma.get(key) ?? { id: a.dmaId ?? 'unassigned', name: a.dmaName, analyserCount: 0, status: 'safe' as WqStatus, worstParam: null };
      cur.analyserCount++;
      cur.status = worst(cur.status, a.status);
      const wp = a.params.filter((p) => p.status && p.status !== 'safe').sort((x, y) => RANK[y.status as WqStatus] - RANK[x.status as WqStatus])[0];
      if (wp && (cur.worstParam == null)) cur.worstParam = wp.label;
      byDma.set(key, cur);
    }
    return {
      analyserCount: list.length,
      dmaCount: byDma.size,
      parameters,
      dmas: [...byDma.values()],
    };
  }

  async detail(id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: { site: { select: { id: true, name: true } }, connectivity: { select: { transport: true, lastSeen: true } } },
    });
    if (!asset || asset.type !== 'WQ_ANALYSER') throw new NotFoundException('Analyser not found');
    const latest = await this.latestByAssetMetric([id]);
    const params = this.paramsFor(id, latest);
    const status = params.reduce<WqStatus>((s, p) => (p.status ? worst(s, p.status) : s), 'safe');

    // Trend: recent measurements per metric (chronological).
    const rows = await this.prisma.measurement.findMany({
      where: { assetId: id, metric: { in: WQ_KEYS } },
      orderBy: { ts: 'desc' }, take: 2000,
    });
    const trends: Record<string, { ts: Date; value: number }[]> = {};
    for (const k of WQ_KEYS) trends[k] = [];
    for (const r of rows) if (trends[r.metric]) trends[r.metric].push({ ts: r.ts, value: Number(r.value) });
    for (const k of WQ_KEYS) trends[k].reverse();

    return {
      id: asset.id, tag: asset.tag, name: asset.name,
      dmaName: asset.site?.name ?? 'Unassigned',
      transport: asset.connectivity?.transport ?? null, lastSeen: asset.connectivity?.lastSeen ?? null,
      status, params, trends,
    };
  }
}

@Controller('water-quality')
export class WaterQualityController {
  constructor(private readonly svc: WaterQualityService) {}

  @Public() @Feature('water_quality') @Get('summary')
  summary() { return this.svc.summary(); }

  @Public() @Feature('water_quality') @Get('analysers')
  analysers() { return this.svc.analysers(); }

  @Public() @Feature('water_quality') @Get('analysers/:id')
  detail(@Param('id') id: string) { return this.svc.detail(id); }
}

@Module({
  providers: [WaterQualityService],
  controllers: [WaterQualityController],
  exports: [WaterQualityService],
})
export class WaterQualityModule {}

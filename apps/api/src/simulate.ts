/**
 * Demo data simulator (showcase only).
 *
 * When DEMO_SIMULATE is set, every DEMO_SIM_INTERVAL_SEC (default 150s ~ 2.5min)
 * this injects a fresh reading for every Water Quality Analyser's parameters,
 * varied around a captured baseline, so the dashboard visibly moves for a live
 * demo. It writes the same generic Measurement rows real RTU/API data would,
 * with source='sim'. It is OFF by default and must never run in production.
 */
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { WQ_METRICS } from './wq';

const WQ_KEYS = WQ_METRICS.map((m) => m.key);
const UNIT = new Map(WQ_METRICS.map((m) => [m.key, m.unit]));

@Injectable()
export class DemoSimulator implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('DemoSimulator');
  private timer: NodeJS.Timeout | null = null;
  // baseline[assetId][metric] = { base, phase }
  private baseline = new Map<string, Map<string, { base: number; phase: number }>>();
  private readonly periodMs = 22 * 60 * 1000; // gentle ~22-min wave

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (!process.env.DEMO_SIMULATE) return;
    const sec = Math.max(30, parseInt(process.env.DEMO_SIM_INTERVAL_SEC || '150', 10) || 150);
    this.log.log(`Demo simulator ON — new WQ readings every ${sec}s`);
    // First tick shortly after boot, then on the interval.
    setTimeout(() => this.tick().catch((e) => this.log.error(e)), 8000);
    this.timer = setInterval(() => this.tick().catch((e) => this.log.error(e)), sec * 1000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async ensureBaselines(assetIds: string[]) {
    const missing = assetIds.filter((id) => !this.baseline.has(id));
    if (missing.length === 0) return;
    const rows = await this.prisma.measurement.findMany({
      where: { assetId: { in: missing }, metric: { in: WQ_KEYS } },
      orderBy: { ts: 'desc' }, take: 8000,
    });
    for (const id of missing) this.baseline.set(id, new Map());
    let h = 0;
    for (const r of rows) {
      const m = this.baseline.get(r.assetId)!;
      if (!m.has(r.metric)) {
        h = (r.assetId.length + r.metric.length + r.metric.charCodeAt(0)) % 100;
        m.set(r.metric, { base: Number(r.value), phase: h / 100 * Math.PI * 2 });
      }
    }
  }

  private async tick() {
    const assets = await this.prisma.asset.findMany({ where: { type: 'WQ_ANALYSER' }, select: { id: true } });
    if (assets.length === 0) return;
    const ids = assets.map((a) => a.id);
    await this.ensureBaselines(ids);

    const now = Date.now();
    const rows: { assetId: string; ts: Date; metric: string; value: number; unit: string | null; quality: string; source: string }[] = [];
    for (const id of ids) {
      const bm = this.baseline.get(id);
      if (!bm) continue;
      for (const key of WQ_KEYS) {
        const b = bm.get(key);
        if (!b) continue;
        const wave = Math.sin(now / this.periodMs + b.phase); // -1..1
        const noise = (Math.random() - 0.5) * 2; // -1..1
        let value: number;
        if (key === 'coliform_cfu') {
          value = Math.max(0, Math.round(b.base + wave * 2 + noise));
        } else {
          value = b.base * (1 + wave * 0.09) + b.base * 0.03 * noise;
          value = Math.round(value * 100) / 100;
        }
        rows.push({ assetId: id, ts: new Date(now), metric: key, value, unit: UNIT.get(key) ?? null, quality: 'good', source: 'sim' });
      }
    }
    if (rows.length) {
      await this.prisma.measurement.createMany({ data: rows });
      await this.prisma.connectivity.updateMany({ where: { assetId: { in: ids } }, data: { lastSeen: new Date(now) } });
    }
  }
}

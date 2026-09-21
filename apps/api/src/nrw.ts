/**
 * NRW Explorer — feature: nrw_explorer (VECTOR, PUBLIC read).
 * Non-revenue water by DMA: water supplied (input) vs billed, NRW volume and %,
 * a modeled physical/commercial loss split, per-DMA ranking, and an overall
 * NRW% trend across reporting periods.
 *
 *   GET /api/nrw/summary
 */
import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Feature, Public } from './decorators';

// Modeled split of NRW into physical (real) vs commercial (apparent) losses.
const PHYSICAL_SHARE = 0.6;

@Injectable()
export class NrwService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const records = (await this.prisma.nrwRecord.findMany({ orderBy: { period: 'asc' } })).map((r) => ({
      area: r.area, period: r.period, input: Number(r.inputKl), billed: Number(r.billedKl),
    }));

    // Overall NRW% per period (trend).
    const byPeriod = new Map<string, { input: number; billed: number }>();
    for (const r of records) {
      const cur = byPeriod.get(r.period) ?? { input: 0, billed: 0 };
      cur.input += r.input; cur.billed += r.billed;
      byPeriod.set(r.period, cur);
    }
    const periods = [...byPeriod.keys()].sort();
    const trend = periods.map((p) => {
      const t = byPeriod.get(p)!;
      return { period: p, nrwPct: t.input ? Math.round(((t.input - t.billed) / t.input) * 1000) / 10 : 0 };
    });
    const latest = periods[periods.length - 1] ?? null;

    // Current KPIs from the latest period.
    const lt = latest ? byPeriod.get(latest)! : { input: 0, billed: 0 };
    const nrwKl = Math.max(0, lt.input - lt.billed);
    const nrwPct = lt.input ? Math.round((nrwKl / lt.input) * 1000) / 10 : 0;
    const physicalKl = Math.round(nrwKl * PHYSICAL_SHARE);
    const commercialKl = Math.round(nrwKl - physicalKl);

    // Per-DMA (latest period), ranked worst first.
    const dmas = records
      .filter((r) => r.period === latest)
      .map((r) => {
        const nrw = Math.max(0, r.input - r.billed);
        return { area: r.area, inputKl: Math.round(r.input), billedKl: Math.round(r.billed), nrwKl: Math.round(nrw), nrwPct: r.input ? Math.round((nrw / r.input) * 1000) / 10 : 0 };
      })
      .sort((a, b) => b.nrwPct - a.nrwPct);

    return {
      period: latest,
      totalInputKl: Math.round(lt.input),
      totalBilledKl: Math.round(lt.billed),
      nrwKl, nrwPct,
      physicalKl, commercialKl,
      physicalPct: nrwKl ? Math.round((physicalKl / nrwKl) * 100) : 0,
      commercialPct: nrwKl ? Math.round((commercialKl / nrwKl) * 100) : 0,
      dmas,
      trend,
    };
  }
}

@Controller('nrw')
export class NrwController {
  constructor(private readonly svc: NrwService) {}

  @Public() @Feature('nrw_explorer') @Get('summary')
  summary() { return this.svc.summary(); }
}

@Module({
  providers: [NrwService],
  controllers: [NrwController],
  exports: [NrwService],
})
export class NrwModule {}

/**
 * Billing & Revenue — feature: billing (VELOCITY, commercial).
 * Revenue assurance: demand raised vs collected, arrears, collection efficiency
 * and connections, rolled up for the selected District -> Block -> Zone scope,
 * from per-site monthly BillingRecords. Read is public.
 *
 *  - GET /api/billing/summary   (PUBLIC) — KPI rollup + 6-month efficiency trend
 *  - GET /api/billing/accounts  (PUBLIC) — per-site latest-period rows (arrears desc)
 */
import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Feature, Public } from './decorators';

type Geo = { district?: string; block?: string; zone?: string };
function geoWhere(f?: Geo) {
  const w: any = {};
  if (f?.district) w.district = f.district;
  if (f?.block) w.block = f.block;
  if (f?.zone) w.zone = f.zone;
  return w;
}
const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(f?: Geo) {
    const rows = await this.prisma.billingRecord.findMany({ where: geoWhere(f) });
    const periods = [...new Set(rows.map((r) => r.period))].sort();
    const latest = periods[periods.length - 1] ?? null;
    const cur = rows.filter((r) => r.period === latest);

    const sum = (arr: typeof rows, k: 'demandInr' | 'collectedInr' | 'arrearsInr' | 'billedKl') =>
      arr.reduce((a, r) => a + Number(r[k]), 0);
    const demand = sum(cur, 'demandInr');
    const collected = sum(cur, 'collectedInr');
    const arrears = sum(cur, 'arrearsInr');
    const connections = cur.reduce((a, r) => a + r.connections, 0);
    const billedKl = sum(cur, 'billedKl');
    const efficiency = demand > 0 ? (collected / demand) * 100 : 0;

    // 6-month collection-efficiency trend for the chart.
    const trend = periods.map((p) => {
      const g = rows.filter((r) => r.period === p);
      const d = sum(g, 'demandInr'); const c = sum(g, 'collectedInr');
      return { label: p, value: d > 0 ? Math.round((c / d) * 100) : 0 };
    });

    // Worst-arrears zone in the latest period.
    const byZone = new Map<string, { name: string; arrears: number }>();
    for (const r of cur) {
      const key = [r.district, r.block, r.zone].filter(Boolean).join(' · ') || 'Unassigned';
      const e = byZone.get(key) ?? { name: key, arrears: 0 };
      e.arrears += Number(r.arrearsInr);
      byZone.set(key, e);
    }
    const worst = [...byZone.values()].sort((a, b) => b.arrears - a.arrears)[0] ?? null;

    return {
      period: latest,
      demandInr: r2(demand), collectedInr: r2(collected), arrearsInr: r2(arrears),
      connections, billedKl: r2(billedKl),
      collectionEfficiency: r1(efficiency),
      trend,
      worst: worst ? { name: worst.name, arrearsInr: r2(worst.arrears) } : null,
    };
  }

  async accounts(f?: Geo) {
    const rows = await this.prisma.billingRecord.findMany({ where: geoWhere(f) });
    const periods = [...new Set(rows.map((r) => r.period))].sort();
    const latest = periods[periods.length - 1] ?? null;
    const cur = rows.filter((r) => r.period === latest).map((r) => {
      const demand = Number(r.demandInr); const collected = Number(r.collectedInr);
      return {
        siteName: r.siteName, district: r.district, block: r.block, zone: r.zone,
        connections: r.connections,
        demandInr: r2(demand), collectedInr: r2(collected), arrearsInr: r2(Number(r.arrearsInr)),
        efficiency: demand > 0 ? r1((collected / demand) * 100) : 0,
      };
    });
    cur.sort((a, b) => b.arrearsInr - a.arrearsInr);
    return cur;
  }
}

@Controller('billing')
export class BillingController {
  constructor(private readonly svc: BillingService) {}

  @Public() @Feature('billing') @Get('summary')
  summary(@Query('district') district?: string, @Query('block') block?: string, @Query('zone') zone?: string) {
    return this.svc.summary({ district, block, zone });
  }

  @Public() @Feature('billing') @Get('accounts')
  accounts(@Query('district') district?: string, @Query('block') block?: string, @Query('zone') zone?: string) {
    return this.svc.accounts({ district, block, zone });
  }
}

@Module({
  providers: [BillingService],
  controllers: [BillingController],
  exports: [BillingService],
})
export class BillingModule {}

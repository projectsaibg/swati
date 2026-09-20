/**
 * M3 Base screens backend:
 *  - GET /api/dashboard/summary   (executive_overview, PUBLIC) — KPI rollup
 *  - GET /api/alerts              (action_center, LOGIN)       — open alerts
 *  - POST /api/alerts/:id/ack     (action_center + alert.ack)  — acknowledge
 *  - GET /api/map/points          (interactive_map, PUBLIC)    — geo points
 *
 * Feature visibility is enforced by the global FeatureGuard: PUBLIC routes are
 * reachable on the no-login frontend, LOGIN routes require a session.
 */
import { Controller, Get, Injectable, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { PrismaService } from './prisma.service';
import { CurrentUser, Feature, Perm, Public } from './decorators';

const DEVICE_TYPES = ['FLOW_METER', 'PRESSURE_SENSOR', 'WATER_LEVEL', 'CHLORINATOR'] as const;
const ONLINE_MS = 24 * 60 * 60 * 1000; // device counts as "online" if seen within 24h

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const [assetGroups, alertGroups, devices, assetsWithLatest] = await Promise.all([
      this.prisma.asset.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.alert.groupBy({ by: ['severity'], where: { status: 'OPEN' }, _count: { _all: true } }),
      this.prisma.asset.findMany({
        where: { type: { in: DEVICE_TYPES as unknown as any[] } },
        include: { connectivity: { select: { lastSeen: true } } },
      }),
      this.prisma.asset.findMany({
        include: { readings: { orderBy: { ts: 'desc' }, take: 1, select: { healthScore: true } } },
      }),
    ]);

    const assetCount = (s: string) => assetGroups.find((g) => g.status === s)?._count._all ?? 0;
    const alertCount = (s: string) => alertGroups.find((g) => g.severity === s)?._count._all ?? 0;

    const now = Date.now();
    const online = devices.filter(
      (d) => d.connectivity?.lastSeen && now - new Date(d.connectivity.lastSeen).getTime() <= ONLINE_MS,
    ).length;

    const healths = assetsWithLatest
      .map((a) => a.readings[0]?.healthScore)
      .filter((h): h is NonNullable<typeof h> => h != null)
      .map((h) => Number(h));
    const avgHealth = healths.length ? Math.round((healths.reduce((a, b) => a + b, 0) / healths.length) * 10) / 10 : null;
    const minHealth = healths.length ? Math.min(...healths) : null;

    return {
      assets: {
        total: assetGroups.reduce((a, g) => a + g._count._all, 0),
        running: assetCount('RUNNING'),
        fault: assetCount('FAULT'),
        stopped: assetCount('STOPPED'),
      },
      devices: { total: devices.length, online, offline: devices.length - online },
      alerts: {
        open: alertGroups.reduce((a, g) => a + g._count._all, 0),
        critical: alertCount('CRITICAL'),
        alarm: alertCount('ALARM'),
        watch: alertCount('WATCH'),
        info: alertCount('INFO'),
      },
      health: { avg: avgHealth, min: minHealth },
      updatedAt: new Date().toISOString(),
    };
  }

  async listAlerts(status: string) {
    const alerts = await this.prisma.alert.findMany({
      where: status === 'ALL' ? {} : { status: status as any },
      orderBy: [{ createdAt: 'desc' }],
      take: 200,
      include: { asset: { select: { tag: true, name: true } } },
    });
    // Rank by severity for display (CRITICAL first), then newest.
    const rank: Record<string, number> = { CRITICAL: 0, ALARM: 1, WATCH: 2, INFO: 3 };
    return alerts
      .map((a) => ({
        id: a.id,
        category: a.category,
        severity: a.severity,
        message: a.message,
        metric: a.metric,
        valueNum: a.valueNum,
        status: a.status,
        createdAt: a.createdAt,
        assetTag: a.asset?.tag ?? null,
        assetName: a.asset?.name ?? null,
      }))
      .sort((x, y) => (rank[x.severity] - rank[y.severity]) || (+new Date(y.createdAt) - +new Date(x.createdAt)));
  }

  async ackAlert(id: string) {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alert not found');
    await this.prisma.alert.update({ where: { id }, data: { status: 'ACKNOWLEDGED' } });
    return this.listAlerts('OPEN');
  }

  async mapPoints() {
    const assets = await this.prisma.asset.findMany({
      where: { latitude: { not: null }, longitude: { not: null } },
      include: {
        readings: { orderBy: { ts: 'desc' }, take: 1, select: { healthScore: true } },
        connectivity: { select: { transport: true, lastSeen: true } },
      },
    });
    return assets.map((a) => ({
      id: a.id,
      tag: a.tag,
      name: a.name,
      type: a.type,
      latitude: a.latitude,
      longitude: a.longitude,
      status: a.status,
      health: a.readings[0]?.healthScore ?? null,
      transport: a.connectivity?.transport ?? null,
    }));
  }
}

class AlertQueryDto {
  @IsOptional() @IsIn(['OPEN', 'ACKNOWLEDGED', 'CLOSED', 'ALL']) status?: string;
}

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Public() @Feature('executive_overview') @Get('summary')
  summary() {
    return this.svc.summary();
  }
}

@Controller('alerts')
export class AlertsController {
  constructor(private readonly svc: DashboardService) {}

  @Feature('action_center') @Get()
  list(@Query() q: AlertQueryDto) {
    return this.svc.listAlerts(q.status ?? 'OPEN');
  }

  @Feature('action_center') @Perm('alert.ack') @Post(':id/ack')
  ack(@Param('id') id: string, @CurrentUser() _user: any) {
    return this.svc.ackAlert(id);
  }
}

@Controller('map')
export class MapController {
  constructor(private readonly svc: DashboardService) {}

  @Public() @Feature('interactive_map') @Get('points')
  points() {
    return this.svc.mapPoints();
  }
}

@Module({
  providers: [DashboardService],
  controllers: [DashboardController, AlertsController, MapController],
  exports: [DashboardService],
})
export class DashboardModule {}

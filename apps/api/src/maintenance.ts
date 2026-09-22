/**
 * Maintenance — feature: maintenance (VELOCITY).
 * Work orders: preventive (scheduled) and corrective (raised from faulted
 * pumps / alerts). Read is public; creating a work order or advancing its
 * status requires login + data.enter. Shares the District -> Block -> Zone
 * filter via denormalised geo columns on WorkOrder.
 *
 *  - GET   /api/maintenance/summary     (PUBLIC) — KPI rollup for the scope
 *  - GET   /api/maintenance/orders      (PUBLIC) — work orders for the scope
 *  - POST  /api/maintenance/orders      (data.enter) — create a work order
 *  - PATCH /api/maintenance/orders/:id  (data.enter) — advance status / edit
 */
import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from './prisma.service';
import { CurrentUser, Feature, Perm, Public } from './decorators';

type Geo = { district?: string; block?: string; zone?: string };
const STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const PRIO_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const STATUS_RANK: Record<string, number> = { OPEN: 0, IN_PROGRESS: 1, DONE: 2, CANCELLED: 3 };

class CreateWoDto {
  @IsString() @MaxLength(160) title!: string;
  @IsOptional() @IsIn(['PREVENTIVE', 'CORRECTIVE']) type?: string;
  @IsOptional() @IsIn(PRIORITIES as unknown as string[]) priority?: string;
  @IsOptional() @IsString() siteId?: string;
  @IsOptional() @IsString() @MaxLength(80) assignee?: string;
  @IsOptional() @IsString() dueAt?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
class UpdateWoDto {
  @IsOptional() @IsIn(STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsIn(PRIORITIES as unknown as string[]) priority?: string;
  @IsOptional() @IsString() @MaxLength(80) assignee?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

function geoWhere(f?: Geo) {
  const w: any = {};
  if (f?.district) w.district = f.district;
  if (f?.block) w.block = f.block;
  if (f?.zone) w.zone = f.zone;
  return w;
}

@Injectable()
export class MaintenanceService {
  constructor(private readonly prisma: PrismaService) {}

  async orders(f?: Geo) {
    const rows = await this.prisma.workOrder.findMany({ where: geoWhere(f) });
    // Open/critical first, then by due date; done/cancelled sink to the bottom.
    rows.sort((a, b) =>
      (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
      (PRIO_RANK[a.priority] ?? 9) - (PRIO_RANK[b.priority] ?? 9) ||
      (a.dueAt ? a.dueAt.getTime() : Infinity) - (b.dueAt ? b.dueAt.getTime() : Infinity));
    return rows.map((w) => ({
      id: w.id, code: w.code, title: w.title, type: w.type, priority: w.priority, status: w.status,
      siteName: w.siteName, assetTag: w.assetTag,
      district: w.district, block: w.block, zone: w.zone,
      assignee: w.assignee, notes: w.notes,
      dueAt: w.dueAt, completedAt: w.completedAt, createdAt: w.createdAt,
    }));
  }

  async summary(f?: Geo) {
    const rows = await this.prisma.workOrder.findMany({ where: geoWhere(f), select: { status: true, type: true, priority: true, dueAt: true } });
    const now = Date.now();
    const open = rows.filter((r) => r.status === 'OPEN').length;
    const inProgress = rows.filter((r) => r.status === 'IN_PROGRESS').length;
    const done = rows.filter((r) => r.status === 'DONE').length;
    const overdue = rows.filter((r) => r.status !== 'DONE' && r.status !== 'CANCELLED' && r.dueAt && r.dueAt.getTime() < now).length;
    const preventive = rows.filter((r) => r.type === 'PREVENTIVE').length;
    const corrective = rows.filter((r) => r.type === 'CORRECTIVE').length;
    const highPriority = rows.filter((r) => (r.status === 'OPEN' || r.status === 'IN_PROGRESS') && (r.priority === 'HIGH' || r.priority === 'CRITICAL')).length;
    return { total: rows.length, open, inProgress, done, overdue, preventive, corrective, highPriority };
  }

  private async nextCode() {
    const n = await this.prisma.workOrder.count();
    return `WO-${String(n + 1).padStart(4, '0')}`;
  }

  async create(dto: CreateWoDto) {
    let siteName: string | null = null;
    let district: string | null = null, block: string | null = null, zone: string | null = null;
    if (dto.siteId) {
      const site = await this.prisma.site.findUnique({ where: { id: dto.siteId }, select: { name: true, district: true, block: true, zone: true } });
      if (site) { siteName = site.name; district = site.district; block = site.block; zone = site.zone; }
    }
    const wo = await this.prisma.workOrder.create({
      data: {
        code: await this.nextCode(),
        title: dto.title,
        type: dto.type ?? 'PREVENTIVE',
        priority: dto.priority ?? 'MEDIUM',
        status: 'OPEN',
        siteId: dto.siteId ?? null, siteName,
        district, block, zone,
        assignee: dto.assignee ?? null,
        notes: dto.notes ?? null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
      },
    });
    return wo;
  }

  async update(id: string, dto: UpdateWoDto) {
    const wo = await this.prisma.workOrder.findUnique({ where: { id } });
    if (!wo) throw new NotFoundException('Work order not found');
    const data: any = {};
    if (dto.status) { data.status = dto.status; data.completedAt = dto.status === 'DONE' ? new Date() : null; }
    if (dto.priority) data.priority = dto.priority;
    if (dto.assignee !== undefined) data.assignee = dto.assignee;
    if (dto.notes !== undefined) data.notes = dto.notes;
    await this.prisma.workOrder.update({ where: { id }, data });
    return this.orders({ district: wo.district ?? undefined, block: wo.block ?? undefined, zone: wo.zone ?? undefined });
  }
}

@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly svc: MaintenanceService) {}

  @Public() @Feature('maintenance') @Get('summary')
  summary(@Query('district') district?: string, @Query('block') block?: string, @Query('zone') zone?: string) {
    return this.svc.summary({ district, block, zone });
  }

  @Public() @Feature('maintenance') @Get('orders')
  orders(@Query('district') district?: string, @Query('block') block?: string, @Query('zone') zone?: string) {
    return this.svc.orders({ district, block, zone });
  }

  @Feature('maintenance') @Perm('data.enter') @Post('orders')
  create(@Body() dto: CreateWoDto, @CurrentUser() _user: any) {
    return this.svc.create(dto);
  }

  @Feature('maintenance') @Perm('data.enter') @Patch('orders/:id')
  update(@Param('id') id: string, @Body() dto: UpdateWoDto, @CurrentUser() _user: any) {
    return this.svc.update(id, dto);
  }
}

@Module({
  providers: [MaintenanceService],
  controllers: [MaintenanceController],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}

/**
 * Valve Control — feature: valve_control (VECTOR, LOGIN).
 *  - GET  /api/valves              list valves + current position + last operator
 *  - GET  /api/valves/:id          one valve + its operation audit trail
 *  - POST /api/valves/:id/operate  (valve.operate) OPEN / CLOSE / SET position;
 *      every operation is logged to ValveOp (who, when, from->to).
 */
import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { PrismaService } from './prisma.service';
import { CurrentUser, Feature, Perm, Public } from './decorators';

class OperateDto {
  @IsIn(['OPEN', 'CLOSE', 'SET']) action!: 'OPEN' | 'CLOSE' | 'SET';
  @IsOptional() @IsNumber() @Min(0) @Max(100) positionPct?: number;
}

@Injectable()
export class ValvesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(f?: { district?: string; block?: string; zone?: string }) {
    const where: any = {};
    if (f?.district) where.district = f.district;
    if (f?.block) where.block = f.block;
    if (f?.zone) where.zone = f.zone;
    const valves = await this.prisma.valve.findMany({
      where,
      orderBy: { tag: 'asc' },
      include: { ops: { orderBy: { ts: 'desc' }, take: 1 } },
    });
    return valves.map((v) => ({
      id: v.id, tag: v.tag, name: v.name, area: v.area, valveType: v.valveType,
      district: v.district, block: v.block, zone: v.zone,
      status: v.status, positionPct: v.positionPct, controllable: v.controllable,
      upstreamBar: v.upstreamBar, downstreamBar: v.downstreamBar, flowKlmin: v.flowKlmin, health: v.health,
      lastOperated: v.lastOperated,
      lastOperator: v.ops[0]?.operator ?? null,
    }));
  }

  async detail(id: string) {
    const v = await this.prisma.valve.findUnique({
      where: { id },
      include: { ops: { orderBy: { ts: 'desc' }, take: 25 } },
    });
    if (!v) throw new NotFoundException('Valve not found');
    return {
      id: v.id, tag: v.tag, name: v.name, area: v.area, valveType: v.valveType,
      status: v.status, positionPct: v.positionPct, controllable: v.controllable,
      upstreamBar: v.upstreamBar, downstreamBar: v.downstreamBar, flowKlmin: v.flowKlmin, health: v.health,
      lastOperated: v.lastOperated,
      ops: v.ops.map((o) => ({ id: o.id, action: o.action, positionPct: o.positionPct, fromStatus: o.fromStatus, toStatus: o.toStatus, operator: o.operator, ts: o.ts })),
    };
  }

  async operate(id: string, dto: OperateDto, user: any) {
    const valve = await this.prisma.valve.findUnique({ where: { id } });
    if (!valve) throw new NotFoundException('Valve not found');
    if (!valve.controllable) throw new BadRequestException('This valve is not remotely controllable');

    let position: number;
    if (dto.action === 'OPEN') position = 100;
    else if (dto.action === 'CLOSE') position = 0;
    else {
      if (dto.positionPct == null) throw new BadRequestException('positionPct required for SET');
      position = dto.positionPct;
    }
    const toStatus = position <= 0 ? 'Closed' : position >= 100 ? 'Open' : 'Throttled';
    const fromStatus = valve.status;

    await this.prisma.valve.update({
      where: { id },
      data: { status: toStatus, positionPct: position, lastOperated: new Date() },
    });
    await this.prisma.valveOp.create({
      data: { valveId: id, action: dto.action, positionPct: position, fromStatus, toStatus, operator: user.name },
    });
    return this.detail(id);
  }
}

@Controller('valves')
export class ValvesController {
  constructor(private readonly svc: ValvesService) {}

  @Public() @Feature('valve_control') @Get()
  list(@Query('district') district?: string, @Query('block') block?: string, @Query('zone') zone?: string) {
    return this.svc.list({ district, block, zone });
  }

  @Public() @Feature('valve_control') @Get(':id')
  detail(@Param('id') id: string) { return this.svc.detail(id); }

  @Feature('valve_control') @Perm('valve.operate') @Post(':id/operate')
  operate(@Param('id') id: string, @Body() dto: OperateDto, @CurrentUser() user: any) {
    return this.svc.operate(id, dto, user);
  }
}

@Module({
  providers: [ValvesService],
  controllers: [ValvesController],
  exports: [ValvesService],
})
export class ValvesModule {}

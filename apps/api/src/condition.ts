/**
 * Pump & Motor condition monitoring (ESA) — feature: condition_monitoring.
 *  - GET  /api/condition/assets          (PUBLIC) — fleet list + latest ESA
 *  - GET  /api/condition/assets/:id      (PUBLIC) — detail + sub-indices + trend
 *  - POST /api/condition/assets/:id/readings (data.enter) — ingest a raw
 *      electrical reading; the ESA engine computes sub-indices + health, the
 *      reading is stored, and an alert is raised on ALARM/CRITICAL.
 */
import { Body, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { IsNumber, IsOptional } from 'class-validator';
import { PrismaService } from './prisma.service';
import { Feature, Perm, Public } from './decorators';
import { EsaInput, computeEsa } from './esa';

const MOTOR_TYPES = ['MOTOR', 'PUMP', 'MOTOR_PUMP'] as const;

function toEsaInput(reading: any, asset: any): EsaInput {
  return {
    voltageV: reading.voltageV, ratedVoltageV: asset.ratedVoltageV,
    currentA: reading.currentA, ratedCurrentA: asset.ratedCurrentA,
    powerFactor: reading.powerFactor,
    voltageUnbalancePct: reading.voltageUnbalancePct,
    currentUnbalancePct: reading.currentUnbalancePct,
    thdVoltagePct: reading.thdVoltagePct,
    thdCurrentPct: reading.thdCurrentPct,
    loadPct: reading.loadPct,
    efficiencyPct: reading.efficiencyPct,
    speedRpm: reading.speedRpm, ratedSpeedRpm: asset.ratedSpeedRpm,
    vibrationMmS: reading.vibrationMmS,
    windingTempC: reading.windingTempC,
    bearingTempC: reading.bearingTempC,
  };
}

class IngestReadingDto {
  @IsOptional() @IsNumber() voltageV?: number;
  @IsOptional() @IsNumber() currentA?: number;
  @IsOptional() @IsNumber() powerFactor?: number;
  @IsOptional() @IsNumber() voltageUnbalancePct?: number;
  @IsOptional() @IsNumber() currentUnbalancePct?: number;
  @IsOptional() @IsNumber() thdVoltagePct?: number;
  @IsOptional() @IsNumber() thdCurrentPct?: number;
  @IsOptional() @IsNumber() loadPct?: number;
  @IsOptional() @IsNumber() efficiencyPct?: number;
  @IsOptional() @IsNumber() speedRpm?: number;
  @IsOptional() @IsNumber() vibrationMmS?: number;
  @IsOptional() @IsNumber() windingTempC?: number;
  @IsOptional() @IsNumber() bearingTempC?: number;
}

@Injectable()
export class ConditionService {
  constructor(private readonly prisma: PrismaService) {}

  async list(f?: { district?: string; block?: string; zone?: string }) {
    const sw: any = {};
    if (f?.district) sw.district = f.district;
    if (f?.block) sw.block = f.block;
    if (f?.zone) sw.zone = f.zone;
    const assets = await this.prisma.asset.findMany({
      where: { type: { in: MOTOR_TYPES as unknown as any[] }, ...(Object.keys(sw).length ? { site: sw } : {}) },
      orderBy: { tag: 'asc' },
      include: {
        readings: { orderBy: { ts: 'desc' }, take: 1 },
        site: { select: { name: true, district: true, block: true, zone: true } },
      },
    });
    return assets.map((a) => {
      const r = a.readings[0];
      const esa = r ? computeEsa(toEsaInput(r, a)) : null;
      return {
        id: a.id, tag: a.tag, name: a.name, type: a.type, status: a.status,
        ratedPowerKw: a.ratedPowerKw,
        siteName: a.site?.name ?? null,
        district: a.site?.district ?? null, block: a.site?.block ?? null, zone: a.site?.zone ?? null,
        lastReadingTs: r?.ts ?? null,
        esa,
      };
    });
  }

  async detail(id: string) {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: { readings: { orderBy: { ts: 'desc' }, take: 60 } },
    });
    if (!asset) throw new NotFoundException('Asset not found');
    const latest = asset.readings[0] ?? null;
    const esa = latest ? computeEsa(toEsaInput(latest, asset)) : null;
    const trend = [...asset.readings]
      .reverse()
      .map((r) => ({ ts: r.ts, healthScore: r.healthScore != null ? Number(r.healthScore) : null }));
    return {
      id: asset.id, tag: asset.tag, name: asset.name, type: asset.type, status: asset.status,
      rated: {
        powerKw: asset.ratedPowerKw, voltageV: asset.ratedVoltageV,
        currentA: asset.ratedCurrentA, speedRpm: asset.ratedSpeedRpm,
      },
      latest: latest
        ? {
            ts: latest.ts,
            voltageV: latest.voltageV, currentA: latest.currentA, powerFactor: latest.powerFactor,
            loadPct: latest.loadPct, efficiencyPct: latest.efficiencyPct,
            vibrationMmS: latest.vibrationMmS, windingTempC: latest.windingTempC, bearingTempC: latest.bearingTempC,
            voltageUnbalancePct: latest.voltageUnbalancePct, currentUnbalancePct: latest.currentUnbalancePct,
            thdVoltagePct: latest.thdVoltagePct, thdCurrentPct: latest.thdCurrentPct, speedRpm: latest.speedRpm,
          }
        : null,
      esa,
      trend,
      recent: asset.readings.slice(0, 15).map((r) => ({
        ts: r.ts, healthScore: r.healthScore, loadPct: r.loadPct,
        vibrationMmS: r.vibrationMmS, bearingTempC: r.bearingTempC, source: r.source,
      })),
    };
  }

  async ingest(id: string, dto: IngestReadingDto) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Asset not found');
    const esa = computeEsa(toEsaInput(dto, asset));
    const reading = await this.prisma.reading.create({
      data: {
        assetId: id,
        ts: new Date(),
        voltageV: dto.voltageV, currentA: dto.currentA, powerFactor: dto.powerFactor,
        voltageUnbalancePct: dto.voltageUnbalancePct, currentUnbalancePct: dto.currentUnbalancePct,
        thdVoltagePct: dto.thdVoltagePct, thdCurrentPct: dto.thdCurrentPct,
        loadPct: dto.loadPct, efficiencyPct: dto.efficiencyPct, speedRpm: dto.speedRpm,
        vibrationMmS: dto.vibrationMmS, windingTempC: dto.windingTempC, bearingTempC: dto.bearingTempC,
        statorIndex: esa.statorIndex, rotorIndex: esa.rotorIndex, bearingIndex: esa.bearingIndex,
        eccentricityIndex: esa.eccentricityIndex, supplyIndex: esa.supplyIndex, loadIndex: esa.loadIndex,
        healthScore: esa.healthScore,
        source: 'api',
      },
    });
    // Keep asset status and raise an alert when the engine flags a problem.
    if (esa.severity === 'ALARM' || esa.severity === 'CRITICAL') {
      await this.prisma.asset.update({ where: { id }, data: { status: 'FAULT' } });
      await this.prisma.alert.create({
        data: {
          assetId: id,
          category: esa.drivers[0] ?? 'Condition',
          severity: esa.severity,
          message: `${asset.tag}: ${esa.drivers[0] ?? 'Condition'} degraded (health ${esa.healthScore})`,
          metric: 'healthScore',
          valueNum: esa.healthScore,
          status: 'OPEN',
        },
      });
    }
    return { readingId: reading.id, esa };
  }
}

@Controller('condition')
export class ConditionController {
  constructor(private readonly svc: ConditionService) {}

  @Public() @Feature('condition_monitoring') @Get('assets')
  list(@Query('district') district?: string, @Query('block') block?: string, @Query('zone') zone?: string) {
    return this.svc.list({ district, block, zone });
  }

  @Public() @Feature('condition_monitoring') @Get('assets/:id')
  detail(@Param('id') id: string) {
    return this.svc.detail(id);
  }

  @Feature('condition_monitoring') @Perm('data.enter') @Post('assets/:id/readings')
  ingest(@Param('id') id: string, @Body() dto: IngestReadingDto) {
    return this.svc.ingest(id, dto);
  }
}

@Module({
  providers: [ConditionService],
  controllers: [ConditionController],
  exports: [ConditionService],
})
export class ConditionModule {}

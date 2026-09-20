/**
 * Devices, connectivity, and generic telemetry ingest.
 *
 * A "device" is an Asset of a sensor type (flow meter, pressure, level,
 * chlorinator, ...) with a 1:1 Connectivity row describing how it reaches us
 * (MQTT / LoRaWAN / WiFi / SIM / Modbus / HTTP) plus a transport-specific
 * `config` JSON. Phase 1 ingests over HTTP; the Phase 2 MQTT/LoRa bridge will
 * write the same Measurement table.
 *
 * Ingest auth (two paths, both land in the same store):
 *  - Operator / gateway app: JWT with `data.enter`.
 *  - Unattended device / RTU modem: `X-Ingest-Key` header matched against
 *    INGEST_API_KEY (fail-closed 503 when the env is unset).
 */
import {
  Body,
  Controller,
  Get,
  Headers,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  IsArray,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from './prisma.service';
import { Perm, Public } from './decorators';

const TRANSPORTS = ['MQTT', 'LORAWAN', 'WIFI', 'SIM', 'RTU_MODBUS', 'HTTP'] as const;
type Transport = (typeof TRANSPORTS)[number];

// Sensor asset types that this module registers as "devices". MOTOR/PUMP etc.
// are managed elsewhere; the API accepts any AssetType but the UI offers these.
export const DEVICE_TYPES = [
  'FLOW_METER',
  'PRESSURE_SENSOR',
  'WATER_LEVEL',
  'CHLORINATOR',
  'MOTOR',
  'PUMP',
  'MOTOR_PUMP',
] as const;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------
class RegisterDeviceDto {
  @IsString() @MinLength(2) tag!: string;
  @IsString() @MinLength(2) name!: string;
  @IsIn(DEVICE_TYPES) type!: (typeof DEVICE_TYPES)[number];
  @IsOptional() @IsString() siteId?: string | null;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
  @IsIn(TRANSPORTS) transport!: Transport;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsString() gatewayId?: string | null;
}
class UpdateDeviceDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() siteId?: string | null;
  @IsOptional() @IsLatitude() latitude?: number;
  @IsOptional() @IsLongitude() longitude?: number;
  @IsOptional() @IsIn(TRANSPORTS) transport?: Transport;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsString() gatewayId?: string | null;
}
class MeasurementInputDto {
  @IsOptional() @IsString() ts?: string; // ISO-8601; defaults to server now
  @IsString() @MinLength(1) metric!: string;
  @IsNumber() value!: number;
  @IsOptional() @IsString() unit?: string;
  @IsOptional() @IsIn(['good', 'suspect', 'bad']) quality?: string;
}
class IngestDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => MeasurementInputDto)
  measurements!: MeasurementInputDto[];
  @IsOptional() @IsString() source?: string;
}
class IngestByTagDto extends IngestDto {
  @IsString() tag!: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const assets = await this.prisma.asset.findMany({
      where: { type: { in: DEVICE_TYPES as unknown as any[] } },
      orderBy: { createdAt: 'asc' },
      include: {
        connectivity: true,
        site: { select: { id: true, name: true } },
        measurements: { orderBy: { ts: 'desc' }, take: 1 },
      },
    });
    return assets.map((a) => ({
      id: a.id,
      tag: a.tag,
      name: a.name,
      type: a.type,
      siteId: a.siteId,
      siteName: a.site?.name ?? null,
      latitude: a.latitude,
      longitude: a.longitude,
      status: a.status,
      transport: a.connectivity?.transport ?? null,
      gatewayId: a.connectivity?.gatewayId ?? null,
      config: a.connectivity?.config ?? {},
      lastSeen: a.connectivity?.lastSeen ?? null,
      lastMeasurement: a.measurements[0]
        ? {
            ts: a.measurements[0].ts,
            metric: a.measurements[0].metric,
            value: a.measurements[0].value,
            unit: a.measurements[0].unit,
          }
        : null,
    }));
  }

  async register(dto: RegisterDeviceDto) {
    const dup = await this.prisma.asset.findUnique({ where: { tag: dto.tag } });
    if (dup) throw new NotFoundException(`Tag ${dto.tag} already exists`);
    const asset = await this.prisma.asset.create({
      data: {
        tag: dto.tag,
        name: dto.name,
        type: dto.type as any,
        siteId: dto.siteId || null,
        latitude: dto.latitude,
        longitude: dto.longitude,
        connectivity: {
          create: {
            transport: dto.transport as any,
            config: (dto.config ?? {}) as any,
            gatewayId: dto.gatewayId || null,
          },
        },
      },
    });
    return { id: asset.id, devices: await this.list() };
  }

  async update(id: string, dto: UpdateDeviceDto) {
    const asset = await this.prisma.asset.findUnique({ where: { id }, include: { connectivity: true } });
    if (!asset) throw new NotFoundException('Device not found');
    await this.prisma.asset.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.siteId !== undefined ? { siteId: dto.siteId || null } : {}),
        ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
        ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
      },
    });
    if (dto.transport !== undefined || dto.config !== undefined || dto.gatewayId !== undefined) {
      await this.prisma.connectivity.upsert({
        where: { assetId: id },
        update: {
          ...(dto.transport !== undefined ? { transport: dto.transport as any } : {}),
          ...(dto.config !== undefined ? { config: dto.config as any } : {}),
          ...(dto.gatewayId !== undefined ? { gatewayId: dto.gatewayId || null } : {}),
        },
        create: {
          assetId: id,
          transport: (dto.transport ?? 'HTTP') as any,
          config: (dto.config ?? {}) as any,
          gatewayId: dto.gatewayId || null,
        },
      });
    }
    return this.list();
  }

  async ingestById(id: string, dto: IngestDto, source: string) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Device not found');
    return this.writeMeasurements(asset.id, dto, source);
  }

  async ingestByTag(dto: IngestByTagDto, source: string) {
    const asset = await this.prisma.asset.findUnique({ where: { tag: dto.tag } });
    if (!asset) throw new NotFoundException(`Device tag ${dto.tag} not found`);
    return this.writeMeasurements(asset.id, dto, source);
  }

  private async writeMeasurements(assetId: string, dto: IngestDto, source: string) {
    const now = new Date();
    const rows = dto.measurements.map((m) => ({
      assetId,
      ts: m.ts ? new Date(m.ts) : now,
      metric: m.metric,
      value: m.value,
      unit: m.unit,
      quality: m.quality,
      source: dto.source ?? source,
    }));
    await this.prisma.measurement.createMany({ data: rows });
    await this.prisma.connectivity
      .update({ where: { assetId }, data: { lastSeen: now } })
      .catch(() => undefined); // device may have no connectivity row yet
    return { accepted: rows.length, assetId };
  }

  async readMeasurements(id: string, metric: string | undefined, limit: number) {
    const asset = await this.prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Device not found');
    return this.prisma.measurement.findMany({
      where: { assetId: id, ...(metric ? { metric } : {}) },
      orderBy: { ts: 'desc' },
      take: Math.min(Math.max(limit, 1), 1000),
    });
  }
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  // Reading the fleet requires a login (default guard); no @Public.
  @Get() list() {
    return this.devices.list();
  }

  @Perm('assets.manage') @Post() register(@Body() dto: RegisterDeviceDto) {
    return this.devices.register(dto);
  }

  @Perm('assets.manage') @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateDeviceDto) {
    return this.devices.update(id, dto);
  }

  @Get(':id/measurements')
  read(@Param('id') id: string, @Query('metric') metric?: string, @Query('limit') limit?: string) {
    return this.devices.readMeasurements(id, metric, limit ? parseInt(limit, 10) : 100);
  }

  // Operator / gateway app push (JWT + data.enter).
  @Perm('data.enter') @Post(':id/measurements')
  ingest(@Param('id') id: string, @Body() dto: IngestDto) {
    return this.devices.ingestById(id, dto, 'api');
  }
}

// Unattended device / RTU-modem push. Public route, but gated by the shared
// ingest key so no operator login is needed on the device side.
@Controller('ingest')
export class IngestController {
  constructor(private readonly devices: DevicesService) {}

  @Public() @Post('measurements')
  ingest(@Headers('x-ingest-key') key: string | undefined, @Body() dto: IngestByTagDto) {
    const expected = process.env.INGEST_API_KEY;
    if (!expected) throw new ServiceUnavailableException('Device ingest not configured');
    if (!key || key !== expected) throw new UnauthorizedException('Invalid ingest key');
    return this.devices.ingestByTag(dto, 'device');
  }
}

@Module({
  providers: [DevicesService],
  controllers: [DevicesController, IngestController],
  exports: [DevicesService],
})
export class DevicesModule {}

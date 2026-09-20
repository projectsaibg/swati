/**
 * GIS import — feature: interactive_map, permission: gis.import.
 * The web client parses the uploaded file (xls/csv/kml) into normalized rows
 * and POSTs them here; this endpoint upserts them as Assets (by tag) so they
 * appear on the map. Keeps file parsing (and its preview UX) on the client.
 */
import { Body, Controller, Injectable, Module, Post } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsLatitude, IsLongitude, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { PrismaService } from './prisma.service';
import { Feature, Perm } from './decorators';

const ASSET_TYPES = ['MOTOR', 'PUMP', 'MOTOR_PUMP', 'RESERVOIR', 'WTP', 'OHT', 'DMA', 'PIPELINE',
  'FLOW_METER', 'PRESSURE_SENSOR', 'WATER_LEVEL', 'CHLORINATOR'];

class GisAssetDto {
  @IsString() @MinLength(1) tag!: string;
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() type?: string;
  @IsLatitude() latitude!: number;
  @IsLongitude() longitude!: number;
}
class GisImportDto {
  @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => GisAssetDto)
  assets!: GisAssetDto[];
}

@Injectable()
export class GisService {
  constructor(private readonly prisma: PrismaService) {}

  async importAssets(dto: GisImportDto) {
    let created = 0;
    let updated = 0;
    for (const a of dto.assets) {
      const type = (a.type && ASSET_TYPES.includes(a.type) ? a.type : 'DMA') as any;
      const existing = await this.prisma.asset.findUnique({ where: { tag: a.tag } });
      if (existing) {
        await this.prisma.asset.update({
          where: { tag: a.tag },
          data: { name: a.name, type, latitude: a.latitude, longitude: a.longitude },
        });
        updated++;
      } else {
        await this.prisma.asset.create({
          data: { tag: a.tag, name: a.name, type, latitude: a.latitude, longitude: a.longitude },
        });
        created++;
      }
    }
    return { created, updated, total: dto.assets.length };
  }
}

@Controller('gis')
export class GisController {
  constructor(private readonly svc: GisService) {}

  @Feature('interactive_map') @Perm('gis.import') @Post('import')
  importAssets(@Body() dto: GisImportDto) {
    return this.svc.importAssets(dto);
  }
}

@Module({
  providers: [GisService],
  controllers: [GisController],
  exports: [GisService],
})
export class GisModule {}

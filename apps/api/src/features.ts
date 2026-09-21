import { Body, Controller, Get, Injectable, Module, Param, Patch, Put } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { PrismaService } from './prisma.service';
import { Perm, Public } from './decorators';

// ---------------------------------------------------------------------------
// Canonical feature registry (see BLUEPRINT.md section 2)
// ---------------------------------------------------------------------------
export type TierName = 'BASE' | 'VECTOR' | 'VELOCITY' | 'QUANTUM';
export type Visibility = 'PUBLIC' | 'LOGIN';

export interface FeatureDef {
  key: string;
  module: string;
  tier: TierName;
  visibility: Visibility;
}

export const TIER_ORDER: TierName[] = ['BASE', 'VECTOR', 'VELOCITY', 'QUANTUM'];

export const FEATURE_REGISTRY: FeatureDef[] = [
  { key: 'executive_overview', module: 'Executive Overview', tier: 'BASE', visibility: 'PUBLIC' },
  { key: 'interactive_map', module: 'Interactive Map', tier: 'BASE', visibility: 'PUBLIC' },
  { key: 'action_center', module: 'Action Center', tier: 'BASE', visibility: 'LOGIN' },
  { key: 'network_analysis', module: 'Network Analysis', tier: 'BASE', visibility: 'LOGIN' },
  { key: 'communication', module: 'Communication', tier: 'BASE', visibility: 'LOGIN' },
  { key: 'accountability', module: 'Accountability', tier: 'BASE', visibility: 'LOGIN' },
  { key: 'field_verification', module: 'Field Verification', tier: 'BASE', visibility: 'LOGIN' },
  { key: 'reports', module: 'Reports', tier: 'BASE', visibility: 'LOGIN' },
  { key: 'key_personnel', module: 'Key Personnel', tier: 'BASE', visibility: 'LOGIN' },
  { key: 'water_quality', module: 'Water Quality', tier: 'VECTOR', visibility: 'PUBLIC' },
  { key: 'nrw_explorer', module: 'NRW Explorer', tier: 'VECTOR', visibility: 'LOGIN' },
  { key: 'valve_control', module: 'Valve Control', tier: 'VECTOR', visibility: 'PUBLIC' },
  { key: 'leak_detection', module: 'ILK Hunter', tier: 'VELOCITY', visibility: 'LOGIN' },
  { key: 'billing', module: 'Billing & Revenue', tier: 'VELOCITY', visibility: 'LOGIN' },
  { key: 'maintenance', module: 'Maintenance', tier: 'VELOCITY', visibility: 'LOGIN' },
  { key: 'condition_monitoring', module: 'Pump/Motor ESA', tier: 'VELOCITY', visibility: 'PUBLIC' },
  { key: 'pump_stations', module: 'Pump Stations', tier: 'VECTOR', visibility: 'PUBLIC' },
  { key: 'predictive', module: 'Predictive Analysis', tier: 'QUANTUM', visibility: 'LOGIN' },
  { key: 'chatbot', module: 'AI Assistant', tier: 'QUANTUM', visibility: 'LOGIN' },
  { key: 'digital_twin', module: 'Digital Twin', tier: 'QUANTUM', visibility: 'PUBLIC' },
];

// admin_panel is always enabled (LOGIN, admin-only) and not part of tier presets.
export const ALWAYS_ON = ['admin_panel'];

/** Feature keys enabled for a cumulative tier. */
export function featuresForTier(tier: TierName): Set<string> {
  const maxIdx = TIER_ORDER.indexOf(tier);
  const keys = FEATURE_REGISTRY.filter((f) => TIER_ORDER.indexOf(f.tier) <= maxIdx).map((f) => f.key);
  return new Set([...keys, ...ALWAYS_ON]);
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------
class UpdateFeatureDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsIn(['PUBLIC', 'LOGIN']) visibility?: Visibility;
}
class SetTierDto {
  @IsIn(TIER_ORDER) tier!: TierName;
}

// ---------------------------------------------------------------------------
// Service — resolves the single deployment's flags, cached in memory.
// ---------------------------------------------------------------------------
@Injectable()
export class FeaturesService {
  private cache: Map<string, { enabled: boolean; visibility: Visibility }> | null = null;
  private deploymentId: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private async load() {
    if (this.cache) return;
    const dep = await this.prisma.deployment.findFirst();
    this.cache = new Map();
    if (!dep) return; // seed not run yet
    this.deploymentId = dep.id;
    const flags = await this.prisma.featureFlag.findMany({ where: { deploymentId: dep.id } });
    for (const f of flags) {
      this.cache.set(f.key, { enabled: f.enabled, visibility: f.visibility as Visibility });
    }
  }

  private invalidate() {
    this.cache = null;
  }

  async getFlag(key: string): Promise<{ enabled: boolean; visibility: Visibility } | null> {
    await this.load();
    return this.cache?.get(key) ?? null;
  }

  /** Public: only enabled features, key + visibility + tier. */
  async getPublicList(): Promise<Array<{ key: string; visibility: Visibility; tier: TierName | null }>> {
    await this.load();
    const tierByKey = new Map(FEATURE_REGISTRY.map((f) => [f.key, f.tier]));
    const out: Array<{ key: string; visibility: Visibility; tier: TierName | null }> = [];
    for (const [key, v] of this.cache ?? []) {
      if (v.enabled) out.push({ key, visibility: v.visibility, tier: tierByKey.get(key) ?? null });
    }
    return out;
  }

  /** Admin: full registry merged with current DB state. */
  async getAllFlags() {
    await this.load();
    return FEATURE_REGISTRY.map((f) => {
      const cur = this.cache?.get(f.key);
      return {
        key: f.key,
        module: f.module,
        tier: f.tier,
        enabled: cur?.enabled ?? false,
        visibility: cur?.visibility ?? f.visibility,
      };
    });
  }

  async setFlag(key: string, dto: UpdateFeatureDto) {
    await this.load();
    if (!this.deploymentId) throw new Error('No deployment');
    await this.prisma.featureFlag.upsert({
      where: { deploymentId_key: { deploymentId: this.deploymentId, key } },
      update: {
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.visibility ? { visibility: dto.visibility } : {}),
      },
      create: {
        deploymentId: this.deploymentId,
        key,
        enabled: dto.enabled ?? false,
        visibility: dto.visibility ?? 'LOGIN',
      },
    });
    this.invalidate();
    return this.getAllFlags();
  }

  /** Apply a tier preset; keeps existing visibility overrides. */
  async setTier(tier: TierName) {
    await this.load();
    if (!this.deploymentId) throw new Error('No deployment');
    const enabledSet = featuresForTier(tier);
    await this.prisma.deployment.update({ where: { id: this.deploymentId }, data: { tier } });
    for (const f of FEATURE_REGISTRY) {
      await this.prisma.featureFlag.upsert({
        where: { deploymentId_key: { deploymentId: this.deploymentId, key: f.key } },
        update: { enabled: enabledSet.has(f.key) },
        create: {
          deploymentId: this.deploymentId,
          key: f.key,
          enabled: enabledSet.has(f.key),
          visibility: f.visibility,
        },
      });
    }
    this.invalidate();
    return this.getAllFlags();
  }
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------
@Controller('public/features')
export class PublicFeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @Public()
  @Get()
  list() {
    return this.features.getPublicList();
  }
}

@Controller('admin')
export class AdminFeaturesController {
  constructor(private readonly features: FeaturesService) {}

  @Perm('features.manage')
  @Get('features')
  all() {
    return this.features.getAllFlags();
  }

  @Perm('features.manage')
  @Patch('features/:key')
  update(@Param('key') key: string, @Body() dto: UpdateFeatureDto) {
    return this.features.setFlag(key, dto);
  }

  @Perm('features.manage')
  @Put('tier')
  tier(@Body() dto: SetTierDto) {
    return this.features.setTier(dto.tier);
  }
}

@Module({
  providers: [FeaturesService],
  controllers: [PublicFeaturesController, AdminFeaturesController],
  exports: [FeaturesService],
})
export class FeaturesModule {}

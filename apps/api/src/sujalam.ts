/**
 * Sujalam Bharat Integration Layer — feature: sujalam_bharat.
 * Phase 1 (foundation): read-only views over the integration entities —
 * scheme/service-area/Sujal-Gaon/infrastructure mappings, provider config and
 * integration health. SWATI operates independently of this layer; it is behind
 * feature flags and every demo record is labelled DEMO / MOCK (NOT GOVERNMENT).
 * Field mapping, validation, the adapter, the mock API and bidirectional sync
 * (Sujalam Bharat push+pull, JJM 1.0 legacy pull) land in later phases.
 *
 *  - GET /api/sujalam/overview   (PUBLIC) — dashboard counts + readiness
 *  - GET /api/sujalam/providers  (PUBLIC) — configured integration providers
 *  - GET /api/sujalam/mappings   (PUBLIC) — entity mappings (optional ?entityType=)
 */
import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Feature, Public } from './decorators';
import { mapEntity, validateEntity, MappingSpec, ValidationRuleSpec } from './sujalam-engine';

const DISCLAIMER =
  'SWATI is architecturally prepared for Sujalam Bharat integration. Official production integration is subject to government API specifications, authorization, credentials, security requirements and data-sharing protocols.';

export type IntegrationSystem = 'SUJALAM_BHARAT' | 'JJM_1_0';
export const SYSTEMS: IntegrationSystem[] = ['SUJALAM_BHARAT', 'JJM_1_0'];
export const ENTITY_TYPES = ['SCHEME', 'SERVICE_AREA', 'SUJAL_GAON', 'INFRASTRUCTURE'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export function normSystem(s?: string): IntegrationSystem {
  return SYSTEMS.includes(s as IntegrationSystem) ? (s as IntegrationSystem) : 'SUJALAM_BHARAT';
}
export function normEntity(e?: string): EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(e ?? '') ? (e as EntityType) : 'SCHEME';
}

@Injectable()
export class SujalamService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const [
      schemes, schemesMapped, serviceAreas, sujalGaon, sujalGaonMapped,
      infra, infraMapped, providers, lastSync,
    ] = await Promise.all([
      this.prisma.schemeProfile.count(),
      this.prisma.schemeProfile.count({ where: { sujalamBharatId: { not: null } } }),
      this.prisma.serviceArea.count(),
      this.prisma.sujalGaon.count(),
      this.prisma.sujalGaon.count({ where: { sujalGaonId: { not: null } } }),
      this.prisma.infrastructureMapping.count(),
      this.prisma.infrastructureMapping.count({ where: { sujalamBharatId: { not: null } } }),
      this.prisma.integrationProvider.findMany({ orderBy: { system: 'asc' } }),
      this.prisma.syncJob.findMany({ orderBy: { startedAt: 'desc' }, take: 1 }),
    ]);

    const byStatus = await this.prisma.schemeProfile.groupBy({ by: ['mappingStatus'], _count: true });
    const status: Record<string, number> = {};
    for (const r of byStatus) status[r.mappingStatus] = r._count;

    const readiness = schemes ? Math.round((schemesMapped / schemes) * 100) : 0;
    return {
      schemes: { total: schemes, mapped: schemesMapped, unmapped: schemes - schemesMapped },
      serviceAreas: { total: serviceAreas },
      sujalGaon: { total: sujalGaon, mapped: sujalGaonMapped, unmapped: sujalGaon - sujalGaonMapped },
      infrastructure: { total: infra, mapped: infraMapped, unmapped: infra - infraMapped },
      status,
      readinessPct: readiness,
      providers: providers.map((p) => ({ system: p.system, name: p.name, enabled: p.enabled, mockMode: p.mockMode, supportsPush: p.supportsPush, supportsPull: p.supportsPull })),
      lastSync: lastSync[0] ? { provider: lastSync[0].provider, direction: lastSync[0].direction, state: lastSync[0].state, at: lastSync[0].startedAt } : null,
      mock: providers.some((p) => p.mockMode),
      disclaimer: DISCLAIMER,
    };
  }

  async providers() {
    return this.prisma.integrationProvider.findMany({ orderBy: { system: 'asc' } });
  }

  async mappings(entityType?: string) {
    return this.prisma.entityMapping.findMany({
      where: entityType ? { entityType } : {},
      orderBy: { updatedAt: 'desc' }, take: 500,
    });
  }

  // --- Phase 2: field/schema mapping + validation --------------------------

  /** Configured field mappings for a provider + entity type. */
  async fieldMappings(system: string, entityType: string) {
    return this.prisma.fieldMapping.findMany({
      where: { externalSystem: normSystem(system), entityType: normEntity(entityType) },
      orderBy: { internalField: 'asc' },
    });
  }

  /** Validation rules for an entity type (provider-specific + provider-agnostic). */
  async validationRules(system: string, entityType: string) {
    const sys = normSystem(system);
    return this.prisma.validationRule.findMany({
      where: { entityType: normEntity(entityType), OR: [{ externalSystem: sys }, { externalSystem: null }] },
      orderBy: [{ field: 'asc' }, { ruleType: 'asc' }],
    });
  }

  /** Load internal entities of a type as flat records ({ id, label, record }). */
  async loadEntities(entityType: EntityType, take = 500, district?: string): Promise<Array<{ id: string; label: string; record: Record<string, unknown> }>> {
    // Geo-scope: filter by district where the model carries one (infra does not).
    const geo = district && district !== 'ALL' ? { district } : {};
    switch (entityType) {
      case 'SCHEME': {
        const rows = await this.prisma.schemeProfile.findMany({ where: geo, take, orderBy: { schemeName: 'asc' } });
        return rows.map((r) => ({ id: r.id, label: r.schemeName, record: {
          schemeKey: r.schemeKey, swatiSchemeId: r.swatiSchemeId, sujalamBharatId: r.sujalamBharatId,
          schemeName: r.schemeName, schemeType: r.schemeType, state: r.state, district: r.district,
          block: r.block, gramPanchayat: r.gramPanchayat, status: r.status,
        } }));
      }
      case 'SERVICE_AREA': {
        const rows = await this.prisma.serviceArea.findMany({ where: geo, take, orderBy: { name: 'asc' } });
        return rows.map((r) => ({ id: r.id, label: r.name, record: {
          serviceAreaId: r.serviceAreaId, sujalamBharatId: r.sujalamBharatId, name: r.name, state: r.state,
          district: r.district, block: r.block, gramPanchayat: r.gramPanchayat, population: r.population,
          households: r.households, fhtc: r.fhtc, targetHouseholds: r.targetHouseholds,
          supplySource: r.supplySource, supplyMode: r.supplyMode, serviceStatus: r.serviceStatus,
          gisBoundary: r.gisBoundary,
        } }));
      }
      case 'SUJAL_GAON': {
        const rows = await this.prisma.sujalGaon.findMany({ where: geo, take, orderBy: { name: 'asc' } });
        return rows.map((r) => ({ id: r.id, label: r.name, record: {
          sujalGaonId: r.sujalGaonId, swatiVillageId: r.swatiVillageId, sujalamBharatId: r.sujalamBharatId,
          name: r.name, state: r.state, district: r.district, block: r.block, gramPanchayat: r.gramPanchayat,
          population: r.population, households: r.households, fhtc: r.fhtc, supplyStatus: r.supplyStatus,
          gisBoundary: r.gisBoundary,
        } }));
      }
      case 'INFRASTRUCTURE': {
        const rows = await this.prisma.infrastructureMapping.findMany({ take, orderBy: { infrastructureId: 'asc' } });
        return rows.map((r) => ({ id: r.id, label: r.infrastructureId, record: {
          infrastructureId: r.infrastructureId, assetTag: r.assetTag, category: r.category,
          sujalamBharatId: r.sujalamBharatId, externalInfraId: r.externalInfraId,
          latitude: r.latitude != null ? Number(r.latitude) : null,
          longitude: r.longitude != null ? Number(r.longitude) : null,
          mappingStatus: r.mappingStatus,
        } }));
      }
    }
  }

  /** Dry-run: map one internal entity to the external payload (no writes). */
  async mapPreview(system: string, entityType: string, id?: string) {
    const sys = normSystem(system);
    const et = normEntity(entityType);
    const [mappings, entities] = await Promise.all([
      this.fieldMappings(sys, et),
      this.loadEntities(et, 500),
    ]);
    const specs: MappingSpec[] = mappings.map((m) => ({
      internalField: m.internalField, externalField: m.externalField, transform: m.transform,
      transformArg: m.transformArg, required: m.required, enabled: m.enabled,
    }));
    const entity = (id ? entities.find((e) => e.id === id) : entities[0]) ?? null;
    if (!entity) {
      return { system: sys, entityType: et, entity: null, mappingCount: mappings.length, internal: {}, external: {}, missingRequired: [] as string[], mock: true, disclaimer: DISCLAIMER };
    }
    const { external, missingRequired } = mapEntity(entity.record, specs);
    return {
      system: sys, entityType: et, mappingCount: mappings.length,
      entity: { id: entity.id, label: entity.label },
      internal: entity.record, external, missingRequired, mock: true, disclaimer: DISCLAIMER,
    };
  }

  /** Validate every entity of a type; return a summary + the failing entities. */
  async validationReport(system: string, entityType: string) {
    const sys = normSystem(system);
    const et = normEntity(entityType);
    const [rules, entities] = await Promise.all([
      this.validationRules(sys, et),
      this.loadEntities(et, 1000),
    ]);
    const specs: ValidationRuleSpec[] = rules.map((r) => ({
      field: r.field, ruleType: r.ruleType, param: r.param, severity: r.severity, message: r.message, enabled: r.enabled,
    }));
    let valid = 0, invalid = 0, withWarnings = 0;
    const issues: Array<{ id: string; label: string; valid: boolean; errors: number; warnings: number; details: unknown[] }> = [];
    for (const e of entities) {
      const report = validateEntity(e.record, specs);
      if (report.valid) valid++; else invalid++;
      if (report.warnings.length) withWarnings++;
      if (!report.valid || report.warnings.length) {
        issues.push({ id: e.id, label: e.label, valid: report.valid, errors: report.errors.length, warnings: report.warnings.length, details: [...report.errors, ...report.warnings] });
      }
    }
    return {
      system: sys, entityType: et, ruleCount: rules.length,
      summary: { total: entities.length, valid, invalid, withWarnings, readyForSync: valid },
      issues: issues.slice(0, 200), mock: true, disclaimer: DISCLAIMER,
    };
  }

  /**
   * GIS layer for the map: geolocated infrastructure assets (points) plus the
   * service-area and village boundaries (GeoJSON polygons) that carry one.
   */
  async gis() {
    const [infra, areas, villages] = await Promise.all([
      this.prisma.infrastructureMapping.findMany({ take: 500, orderBy: { infrastructureId: 'asc' } }),
      this.prisma.serviceArea.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.sujalGaon.findMany({ orderBy: { name: 'asc' } }),
    ]);
    const points = infra
      .filter((a) => a.latitude != null && a.longitude != null)
      .map((a) => ({ id: a.id, label: a.infrastructureId, lat: Number(a.latitude), lng: Number(a.longitude), mapped: !!a.sujalamBharatId }));
    const boundaries = [
      ...areas.filter((a) => a.gisBoundary != null).map((a) => ({ id: a.id, label: a.name, kind: 'SERVICE_AREA' as const, geojson: a.gisBoundary })),
      ...villages.filter((v) => v.gisBoundary != null).map((v) => ({ id: v.id, label: v.name, kind: 'SUJAL_GAON' as const, geojson: v.gisBoundary })),
    ];
    return {
      points, boundaries,
      counts: {
        assets: infra.length, assetsGeolocated: points.length,
        serviceAreas: areas.length, serviceAreasWithBoundary: areas.filter((a) => a.gisBoundary != null).length,
        villages: villages.length, villagesWithBoundary: villages.filter((v) => v.gisBoundary != null).length,
      },
      mock: true, disclaimer: DISCLAIMER,
    };
  }
}

@Controller('sujalam')
export class SujalamController {
  constructor(private readonly svc: SujalamService) {}

  @Public() @Feature('sujalam_bharat') @Get('overview')
  overview() { return this.svc.overview(); }

  @Public() @Feature('sujalam_bharat') @Get('providers')
  providers() { return this.svc.providers(); }

  @Public() @Feature('sujalam_bharat') @Get('mappings')
  mappings(@Query('entityType') entityType?: string) { return this.svc.mappings(entityType); }

  @Public() @Feature('sujalam_bharat') @Get('field-mappings')
  fieldMappings(@Query('system') system?: string, @Query('entityType') entityType?: string) {
    return this.svc.fieldMappings(system ?? '', entityType ?? '');
  }

  @Public() @Feature('sujalam_bharat') @Get('validation-rules')
  validationRules(@Query('system') system?: string, @Query('entityType') entityType?: string) {
    return this.svc.validationRules(system ?? '', entityType ?? '');
  }

  @Public() @Feature('sujalam_bharat') @Get('map-preview')
  mapPreview(@Query('system') system?: string, @Query('entityType') entityType?: string, @Query('id') id?: string) {
    return this.svc.mapPreview(system ?? '', entityType ?? '', id);
  }

  @Public() @Feature('sujalam_bharat') @Get('validation-report')
  validationReport(@Query('system') system?: string, @Query('entityType') entityType?: string) {
    return this.svc.validationReport(system ?? '', entityType ?? '');
  }

  @Public() @Feature('sujalam_bharat') @Get('gis')
  gis() { return this.svc.gis(); }
}

// The Nest module is defined in ./sujalam.module to avoid a circular import with
// ./sujalam-sync (SyncService depends on SujalamService).

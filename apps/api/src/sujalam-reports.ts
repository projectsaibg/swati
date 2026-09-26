/**
 * Sujalam Bharat Integration Layer — Phase 4 reports.
 *
 * Read-only, @Public governance/operational reports built by aggregating the
 * integration entities, the Phase 2 validation engine, and the Phase 3 sync/
 * import history. All figures are DEMO. Reports are district-filterable where it
 * makes sense (readiness).
 *
 *  - GET /sujalam/reports                 index of report types
 *  - GET /sujalam/reports/readiness       mapping / validation / GIS readiness
 *  - GET /sujalam/reports/sync-activity   sync job activity + open conflicts
 *  - GET /sujalam/reports/jjm-migration   JJM 1.0 legacy import totals
 *  - GET /sujalam/role-mappings           RBAC role-mapping matrix
 */
import { Controller, Get, Injectable, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Feature, Public } from './decorators';
import { SujalamService, ENTITY_TYPES, EntityType, normSystem } from './sujalam';
import { validateEntity, ValidationRuleSpec } from './sujalam-engine';

const DISCLAIMER =
  'Demonstration figures only. Not an official government report; production reporting is subject to Sujalam Bharat data-sharing agreements.';

const ENTITY_LABEL: Record<EntityType, string> = {
  SCHEME: 'Schemes', SERVICE_AREA: 'Service areas', SUJAL_GAON: 'Sujal Gaon villages', INFRASTRUCTURE: 'Infrastructure',
};

export interface ReadinessRow {
  entityType: EntityType; label: string; total: number; mapped: number; mappedPct: number;
  valid: number; validPct: number; gisCovered: number | null; gisPct: number | null;
}

/** Overall readiness = mean of per-type mapping percentages (0 when empty). */
export function overallReadiness(rows: { mappedPct: number }[]): number {
  if (!rows.length) return 0;
  return Math.round(rows.reduce((s, r) => s + r.mappedPct, 0) / rows.length);
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

@Injectable()
export class ReportService {
  constructor(private readonly prisma: PrismaService, private readonly sujalam: SujalamService) {}

  async readiness(district?: string) {
    const system = normSystem('SUJALAM_BHARAT');
    const rows: ReadinessRow[] = [];
    for (const et of ENTITY_TYPES) {
      const [entities, ruleRows] = await Promise.all([
        this.sujalam.loadEntities(et, 2000, district),
        this.sujalam.validationRules(system, et),
      ]);
      const rspecs: ValidationRuleSpec[] = ruleRows.map((r) => ({ field: r.field, ruleType: r.ruleType, param: r.param, severity: r.severity, message: r.message, enabled: r.enabled }));
      let mapped = 0, valid = 0, gis = 0;
      const gisApplies = et === 'SERVICE_AREA' || et === 'SUJAL_GAON' || et === 'INFRASTRUCTURE';
      for (const e of entities) {
        if (e.record.sujalamBharatId) mapped++;
        if (validateEntity(e.record, rspecs).valid) valid++;
        if (gisApplies) {
          const geo = et === 'INFRASTRUCTURE' ? e.record.latitude : e.record.gisBoundary;
          if (geo !== null && geo !== undefined) gis++;
        }
      }
      rows.push({
        entityType: et, label: ENTITY_LABEL[et], total: entities.length,
        mapped, mappedPct: pct(mapped, entities.length),
        valid, validPct: pct(valid, entities.length),
        gisCovered: gisApplies ? gis : null, gisPct: gisApplies ? pct(gis, entities.length) : null,
      });
    }
    return { district: district && district !== 'ALL' ? district : 'ALL', rows, overallReadinessPct: overallReadiness(rows), mock: true, disclaimer: DISCLAIMER };
  }

  async syncActivity() {
    const jobs = await this.prisma.syncJob.findMany({ orderBy: { startedAt: 'desc' }, take: 200 });
    const byState: Record<string, number> = {};
    const byDirection: Record<string, number> = {};
    let success = 0, failed = 0, rejected = 0;
    for (const j of jobs) {
      byState[j.state] = (byState[j.state] ?? 0) + 1;
      byDirection[j.direction] = (byDirection[j.direction] ?? 0) + 1;
      success += j.success; failed += j.failed; rejected += j.rejected;
    }
    const lastPush = jobs.find((j) => j.direction === 'PUSH') ?? null;
    const lastPull = jobs.find((j) => j.direction === 'PULL') ?? null;

    const pullFailed = await this.prisma.syncRecord.findMany({ where: { direction: 'PULL', state: 'FAILED' }, take: 500, orderBy: { ts: 'desc' } });
    const openConflicts = pullFailed.filter((r) => { const v = r.response as any; return v?.conflict && !v?.resolved; }).length;

    return {
      totalJobs: jobs.length, byState, byDirection,
      totals: { success, failed, rejected }, openConflicts,
      lastPush: lastPush ? { entityType: lastPush.entityType, state: lastPush.state, at: lastPush.startedAt } : null,
      lastPull: lastPull ? { entityType: lastPull.entityType, state: lastPull.state, at: lastPull.startedAt } : null,
      mock: true, disclaimer: DISCLAIMER,
    };
  }

  async jjmMigration() {
    const imports = await this.prisma.legacyImport.findMany({ orderBy: { startedAt: 'desc' }, take: 50 });
    const totals = imports.reduce((acc, l) => ({ batches: acc.batches + 1, total: acc.total + l.total, created: acc.created + l.created, linked: acc.linked + l.linked, skipped: acc.skipped + l.skipped }), { batches: 0, total: 0, created: 0, linked: 0, skipped: 0 });
    return {
      totals,
      batches: imports.map((l) => ({ id: l.id, batchLabel: l.batchLabel, state: l.state, total: l.total, created: l.created, linked: l.linked, skipped: l.skipped, startedAt: l.startedAt })),
      mock: true, disclaimer: DISCLAIMER,
    };
  }

  async roleMatrix() {
    const rows = await this.prisma.roleMapping.findMany({ orderBy: { swatiRole: 'asc' } });
    return rows.map((r) => ({ swatiRole: r.swatiRole, externalRole: r.externalRole, externalSystem: r.externalSystem, canPush: r.canPush, canPull: r.canPull, canResolve: r.canResolve, canImport: r.canImport, geoScope: r.geoScope }));
  }

  async index() {
    return {
      reports: [
        { key: 'readiness', label: 'Integration readiness', description: 'Mapping, validation and GIS coverage by entity type.' },
        { key: 'sync-activity', label: 'Sync activity', description: 'Push/pull job history, outcomes and open conflicts.' },
        { key: 'jjm-migration', label: 'JJM 1.0 migration', description: 'Legacy asset import batches and totals.' },
        { key: 'access-matrix', label: 'Access matrix (RBAC)', description: 'Role mapping and integration capabilities.' },
      ],
      generatedAt: new Date().toISOString(), mock: true, disclaimer: DISCLAIMER,
    };
  }
}

@Controller('sujalam')
export class ReportController {
  constructor(private readonly svc: ReportService) {}

  @Public() @Feature('sujalam_bharat') @Get('reports')
  index() { return this.svc.index(); }

  @Public() @Feature('sujalam_bharat') @Get('reports/readiness')
  readiness(@Query('district') district?: string) { return this.svc.readiness(district); }

  @Public() @Feature('sujalam_bharat') @Get('reports/sync-activity')
  syncActivity() { return this.svc.syncActivity(); }

  @Public() @Feature('sujalam_bharat') @Get('reports/jjm-migration')
  jjmMigration() { return this.svc.jjmMigration(); }

  @Public() @Feature('sujalam_bharat') @Get('role-mappings')
  roleMappings() { return this.svc.roleMatrix(); }
}

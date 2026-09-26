/**
 * Sujalam Bharat Integration Layer — Phase 3 bidirectional sync + conflicts.
 *
 * Composes the Phase 2 engines (map/validate) with the Phase 3 mock adapters to
 * run push, pull and legacy import as real, persisted jobs (SyncJob/SyncRecord/
 * LegacyImport) with a government audit trail (GovAuditLog). Everything is MOCK:
 * no government API is contacted; adapters simulate outcomes deterministically.
 *
 *  - push:   valid entities -> mapped payload -> adapter.push -> mark SYNCED / FAILED
 *  - pull:   adapter proposes government-side changes -> matches or CONFLICT
 *  - import: JJM 1.0 legacy asset inventory -> link existing / create new
 *  - conflicts: list open field-level conflicts and resolve (keep internal / take external)
 *
 * Reads are @Public; mutations require @Perm('data.enter') (login-for-actions),
 * matching the rest of the app.
 */
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, Post,
} from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { PrismaService } from './prisma.service';
import { CurrentUser, Feature, Perm, Public } from './decorators';
import { SujalamService, EntityType, IntegrationSystem, SYSTEMS, ENTITY_TYPES, normSystem, normEntity } from './sujalam';
import { mapEntity, validateEntity, MappingSpec, ValidationRuleSpec } from './sujalam-engine';
import { adapterFor, Jjm10MockAdapter, CONFLICT_FIELD, PushInput } from './sujalam-adapters';

// Entity types whose model carries a mappingStatus column.
const HAS_STATUS: Record<EntityType, boolean> = {
  SCHEME: true, SERVICE_AREA: false, SUJAL_GAON: true, INFRASTRUCTURE: true,
};

class SyncDto {
  @IsOptional() @IsIn(SYSTEMS) system?: IntegrationSystem;
  @IsOptional() @IsIn(ENTITY_TYPES as unknown as string[]) entityType?: EntityType;
}
class ResolveDto {
  @IsIn(['INTERNAL', 'EXTERNAL']) resolution!: 'INTERNAL' | 'EXTERNAL';
}

export interface AuthUser { email?: string; roleName?: string; permissions?: string[] }
export interface AccessContext {
  roleName: string | null; externalRole: string | null;
  canPush: boolean; canPull: boolean; canResolve: boolean; canImport: boolean;
  geoScope: string; mapped: boolean;
}

@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService, private readonly sujalam: SujalamService) {}

  /**
   * Resolve the acting user's integration RBAC. Administrators (permission '*')
   * get full access; everyone else is governed by their RoleMapping row. An
   * unmapped role (or anonymous) gets no capabilities.
   */
  async resolveAccess(user?: AuthUser): Promise<AccessContext> {
    const perms = user?.permissions ?? [];
    if (perms.includes('*')) {
      return { roleName: user?.roleName ?? 'Administrator', externalRole: 'State Administrator', canPush: true, canPull: true, canResolve: true, canImport: true, geoScope: 'ALL', mapped: true };
    }
    const none: AccessContext = { roleName: user?.roleName ?? null, externalRole: null, canPush: false, canPull: false, canResolve: false, canImport: false, geoScope: 'ALL', mapped: false };
    if (!user?.roleName) return none;
    const rm = await this.prisma.roleMapping.findUnique({ where: { swatiRole: user.roleName } });
    if (!rm) return none;
    return { roleName: user.roleName, externalRole: rm.externalRole, canPush: rm.canPush, canPull: rm.canPull, canResolve: rm.canResolve, canImport: rm.canImport, geoScope: rm.geoScope, mapped: true };
  }

  // --- push ---------------------------------------------------------------
  async push(systemIn: string, entityTypeIn: string, user?: AuthUser) {
    const system = normSystem(systemIn);
    const entityType = normEntity(entityTypeIn);
    const access = await this.resolveAccess(user);
    if (!access.canPush) throw new ForbiddenException('Your integration role is not authorized to push.');
    const actor = user?.email ?? 'system';
    const adapter = adapterFor(system);
    if (!adapter.supportsPush || !adapter.push) {
      throw new BadRequestException(`${system} does not support push.`);
    }

    const [entities, mapRows, ruleRows] = await Promise.all([
      this.sujalam.loadEntities(entityType, 500, access.geoScope),
      this.sujalam.fieldMappings(system, entityType),
      this.sujalam.validationRules(system, entityType),
    ]);
    const specs: MappingSpec[] = mapRows.map((m) => ({
      internalField: m.internalField, externalField: m.externalField, transform: m.transform,
      transformArg: m.transformArg, required: m.required, enabled: m.enabled,
    }));
    const rspecs: ValidationRuleSpec[] = ruleRows.map((r) => ({
      field: r.field, ruleType: r.ruleType, param: r.param, severity: r.severity, message: r.message, enabled: r.enabled,
    }));

    const job = await this.prisma.syncJob.create({
      data: { provider: system, direction: 'PUSH', entityType, state: 'RUNNING', total: entities.length, mock: true, triggeredBy: actor ?? 'system' },
    });

    const inputs: PushInput[] = [];
    const recData: any[] = [];
    let rejected = 0;
    for (const e of entities) {
      const report = validateEntity(e.record, rspecs);
      if (!report.valid) {
        rejected++;
        recData.push({ syncJobId: job.id, entityType, internalEntityId: e.id, direction: 'PUSH', state: 'FAILED', error: 'Validation failed: ' + report.errors.map((x) => x.message).join('; ') });
        continue;
      }
      const { external } = mapEntity(e.record, specs);
      inputs.push({ internalId: e.id, externalId: (e.record.sujalamBharatId as string) ?? null, label: e.label, payload: external });
    }

    const outcomes = adapter.push(entityType, inputs);
    let success = 0, failed = 0;
    for (const o of outcomes) {
      recData.push({ syncJobId: job.id, entityType, internalEntityId: o.internalId, externalEntityId: o.externalId ?? null, direction: 'PUSH', state: o.state === 'SUCCESS' ? 'SUCCESS' : 'FAILED', error: o.message ?? null });
      if (o.state === 'SUCCESS') {
        success++;
        try { await this.markPushed(entityType, o.internalId, o.externalId ?? null); } catch { /* unique clash: leave status */ }
      } else {
        failed++;
      }
    }
    await this.prisma.syncRecord.createMany({ data: recData });

    const state = failed || rejected ? (success ? 'PARTIAL' : 'FAILED') : 'SUCCESS';
    await this.prisma.syncJob.update({ where: { id: job.id }, data: { state, success, failed, rejected, finishedAt: new Date() } });
    await this.prisma.govAuditLog.create({ data: { actor: actor ?? 'system', action: 'SYNC_PUSH', entityType, externalSystem: system, syncJobId: job.id, newValue: { success, failed, rejected } } });
    return { jobId: job.id, direction: 'PUSH', system, entityType, total: entities.length, success, failed, rejected, state, mock: true };
  }

  // --- pull ---------------------------------------------------------------
  async pull(systemIn: string, entityTypeIn: string, user?: AuthUser) {
    const system = normSystem(systemIn);
    const entityType = normEntity(entityTypeIn);
    const access = await this.resolveAccess(user);
    if (!access.canPull) throw new ForbiddenException('Your integration role is not authorized to pull.');
    const actor = user?.email ?? 'system';
    const adapter = adapterFor(system);
    if (!adapter.supportsPull || !adapter.pull) {
      throw new BadRequestException(`${system} does not support pull.`);
    }

    const entities = await this.sujalam.loadEntities(entityType, 500, access.geoScope);
    const outcomes = adapter.pull(entityType, entities.map((e) => ({
      internalId: e.id, externalId: (e.record.sujalamBharatId as string) ?? null, label: e.label, fields: e.record,
    })));
    const byId = new Map(entities.map((e) => [e.id, e]));

    const job = await this.prisma.syncJob.create({
      data: { provider: system, direction: 'PULL', entityType, state: 'RUNNING', total: entities.length, mock: true, triggeredBy: actor ?? 'system' },
    });

    let matched = 0, conflicts = 0;
    const recData: any[] = [];
    for (const o of outcomes) {
      const ent = byId.get(o.internalId);
      if (o.conflict) {
        conflicts++;
        recData.push({
          syncJobId: job.id, entityType, internalEntityId: o.internalId,
          externalEntityId: (ent?.record.sujalamBharatId as string) ?? null, direction: 'PULL', state: 'FAILED',
          error: `Conflict on ${o.field}`,
          response: { conflict: true, resolved: false, field: o.field, internalValue: o.internalValue ?? null, externalValue: o.externalValue ?? null, label: ent?.label ?? null },
        });
        try { await this.markStatus(entityType, o.internalId, 'CONFLICT'); } catch { /* no-op */ }
      } else {
        matched++;
      }
    }
    if (recData.length) await this.prisma.syncRecord.createMany({ data: recData });

    const state = conflicts ? (matched ? 'PARTIAL' : 'FAILED') : 'SUCCESS';
    await this.prisma.syncJob.update({ where: { id: job.id }, data: { state, success: matched, failed: 0, rejected: conflicts, finishedAt: new Date() } });
    await this.prisma.govAuditLog.create({ data: { actor: actor ?? 'system', action: 'SYNC_PULL', entityType, externalSystem: system, syncJobId: job.id, newValue: { matched, conflicts } } });
    return { jobId: job.id, direction: 'PULL', system, entityType, total: entities.length, matched, conflicts, state, mock: true };
  }

  // --- JJM 1.0 legacy import ---------------------------------------------
  async importJjm(user?: AuthUser) {
    const access = await this.resolveAccess(user);
    if (!access.canImport) throw new ForbiddenException('Your integration role is not authorized to run legacy imports.');
    const actor = user?.email ?? 'system';
    const adapter = new Jjm10MockAdapter();
    const existing = await this.prisma.infrastructureMapping.findMany({ where: { externalInfraId: { not: null } }, select: { externalInfraId: true } });
    const existingIds = existing.map((e) => e.externalInfraId!).filter(Boolean);
    const recs = adapter.pullLegacy(existingIds);

    const batch = await this.prisma.legacyImport.create({
      data: { source: 'JJM_1_0', batchLabel: `jjm-import-${new Date().toISOString().slice(0, 10)}`, entityType: 'asset', state: 'RUNNING', total: recs.length, triggeredBy: actor ?? 'system' },
    });

    let created = 0, linked = 0, skipped = 0;
    for (const r of recs) {
      if (!r.externalId) { skipped++; continue; }
      const match = await this.prisma.infrastructureMapping.findFirst({ where: { externalInfraId: r.externalId } });
      if (match) { linked++; continue; }
      const infraId = `SWATI-INF-JJM-${r.externalId}`;
      await this.prisma.infrastructureMapping.upsert({
        where: { infrastructureId: infraId },
        update: { externalInfraId: r.externalId, category: r.category },
        create: { infrastructureId: infraId, externalInfraId: r.externalId, category: r.category, mappingStatus: 'IN_PROGRESS', demo: true },
      });
      created++;
    }
    await this.prisma.legacyImport.update({ where: { id: batch.id }, data: { state: 'SUCCESS', created, linked, skipped, finishedAt: new Date() } });
    await this.prisma.govAuditLog.create({ data: { actor: actor ?? 'system', action: 'LEGACY_IMPORT', externalSystem: 'JJM_1_0', newValue: { created, linked, skipped } } });
    return { batchId: batch.id, total: recs.length, created, linked, skipped, mock: true };
  }

  // --- conflicts ----------------------------------------------------------
  async conflicts() {
    const recs = await this.prisma.syncRecord.findMany({ where: { direction: 'PULL', state: 'FAILED' }, orderBy: { ts: 'desc' }, take: 300 });
    return recs
      .filter((r) => { const v = r.response as any; return v?.conflict && !v?.resolved; })
      .map((r) => {
        const v = r.response as any;
        return { id: r.id, entityType: r.entityType, internalEntityId: r.internalEntityId, externalEntityId: r.externalEntityId, label: v?.label ?? null, field: v?.field ?? null, internalValue: v?.internalValue ?? null, externalValue: v?.externalValue ?? null, ts: r.ts };
      });
  }

  async resolveConflict(recordId: string, resolution: 'INTERNAL' | 'EXTERNAL', user?: AuthUser) {
    const access = await this.resolveAccess(user);
    if (!access.canResolve) throw new ForbiddenException('Your integration role is not authorized to resolve conflicts.');
    const actor = user?.email ?? 'system';
    const rec = await this.prisma.syncRecord.findUnique({ where: { id: recordId } });
    if (!rec) throw new NotFoundException('Conflict record not found.');
    const resp = (rec.response as any) ?? {};
    if (!resp.conflict || resp.resolved) throw new BadRequestException('This record is not an open conflict.');
    const entityType = rec.entityType as EntityType;
    const id = rec.internalEntityId!;
    const field = resp.field as string;

    if (resolution === 'EXTERNAL') {
      await this.applyField(entityType, id, field, resp.externalValue);
    }
    try { await this.markStatus(entityType, id, 'SYNCED'); } catch { /* no-op */ }
    await this.prisma.syncRecord.update({ where: { id: recordId }, data: { state: 'SUCCESS', response: { ...resp, resolved: true, resolution } } });
    await this.prisma.govAuditLog.create({
      data: {
        actor: actor ?? 'system', action: 'CONFLICT_RESOLVE', entityType, entityId: id, reason: resolution,
        oldValue: { [field]: resp.internalValue ?? null },
        newValue: { [field]: resolution === 'EXTERNAL' ? resp.externalValue ?? null : resp.internalValue ?? null },
      },
    });
    return { id: recordId, resolved: true, resolution };
  }

  async jobs() {
    const [sync, legacy] = await Promise.all([
      this.prisma.syncJob.findMany({ orderBy: { startedAt: 'desc' }, take: 30 }),
      this.prisma.legacyImport.findMany({ orderBy: { startedAt: 'desc' }, take: 15 }),
    ]);
    return {
      syncJobs: sync.map((j) => ({ id: j.id, provider: j.provider, direction: j.direction, entityType: j.entityType, state: j.state, total: j.total, success: j.success, failed: j.failed, rejected: j.rejected, startedAt: j.startedAt, finishedAt: j.finishedAt })),
      legacyImports: legacy.map((l) => ({ id: l.id, source: l.source, batchLabel: l.batchLabel, state: l.state, total: l.total, created: l.created, linked: l.linked, skipped: l.skipped, startedAt: l.startedAt })),
    };
  }

  // --- entity mutation helpers -------------------------------------------
  private async markPushed(entityType: EntityType, id: string, externalId: string | null) {
    const now = new Date();
    if (entityType === 'SCHEME') {
      await this.prisma.schemeProfile.update({ where: { id }, data: { mappingStatus: 'SYNCED', lastSyncedAt: now, ...(externalId ? { sujalamBharatId: externalId } : {}) } });
    } else if (entityType === 'SUJAL_GAON') {
      await this.prisma.sujalGaon.update({ where: { id }, data: { mappingStatus: 'SYNCED', ...(externalId ? { sujalamBharatId: externalId } : {}) } });
    } else if (entityType === 'INFRASTRUCTURE') {
      await this.prisma.infrastructureMapping.update({ where: { id }, data: { mappingStatus: 'SYNCED', ...(externalId ? { sujalamBharatId: externalId } : {}) } });
    } else if (entityType === 'SERVICE_AREA') {
      if (externalId) await this.prisma.serviceArea.update({ where: { id }, data: { sujalamBharatId: externalId } });
    }
  }

  private async markStatus(entityType: EntityType, id: string, status: 'CONFLICT' | 'SYNCED') {
    if (!HAS_STATUS[entityType]) return;
    if (entityType === 'SCHEME') await this.prisma.schemeProfile.update({ where: { id }, data: { mappingStatus: status } });
    else if (entityType === 'SUJAL_GAON') await this.prisma.sujalGaon.update({ where: { id }, data: { mappingStatus: status } });
    else if (entityType === 'INFRASTRUCTURE') await this.prisma.infrastructureMapping.update({ where: { id }, data: { mappingStatus: status } });
  }

  /** Apply the external value to the entity — only the sanctioned conflict field. */
  private async applyField(entityType: EntityType, id: string, field: string, value: unknown) {
    if (field !== CONFLICT_FIELD[entityType]) return; // defense-in-depth: never write an arbitrary field
    const data: any = { [field]: value };
    if (entityType === 'SCHEME') await this.prisma.schemeProfile.update({ where: { id }, data });
    else if (entityType === 'SERVICE_AREA') await this.prisma.serviceArea.update({ where: { id }, data });
    else if (entityType === 'SUJAL_GAON') await this.prisma.sujalGaon.update({ where: { id }, data });
    else if (entityType === 'INFRASTRUCTURE') await this.prisma.infrastructureMapping.update({ where: { id }, data });
  }
}

@Controller('sujalam')
export class SyncController {
  constructor(private readonly svc: SyncService) {}

  @Public() @Feature('sujalam_bharat') @Get('sync/jobs')
  jobs() { return this.svc.jobs(); }

  @Public() @Feature('sujalam_bharat') @Get('conflicts')
  conflicts() { return this.svc.conflicts(); }

  // Optional-auth: returns the current user's integration RBAC (all-false when
  // anonymous), so the UI can gate per-capability actions.
  @Public() @Feature('sujalam_bharat') @Get('my-access')
  myAccess(@CurrentUser() user?: AuthUser) { return this.svc.resolveAccess(user); }

  @Feature('sujalam_bharat') @Perm('data.enter') @Post('sync/push')
  push(@Body() dto: SyncDto, @CurrentUser() user?: AuthUser) {
    return this.svc.push(dto.system ?? '', dto.entityType ?? '', user);
  }

  @Feature('sujalam_bharat') @Perm('data.enter') @Post('sync/pull')
  pull(@Body() dto: SyncDto, @CurrentUser() user?: AuthUser) {
    return this.svc.pull(dto.system ?? '', dto.entityType ?? '', user);
  }

  @Feature('sujalam_bharat') @Perm('data.enter') @Post('import/jjm')
  importJjm(@CurrentUser() user?: AuthUser) {
    return this.svc.importJjm(user);
  }

  @Feature('sujalam_bharat') @Perm('data.enter') @Post('conflicts/:id/resolve')
  resolve(@Param('id') id: string, @Body() dto: ResolveDto, @CurrentUser() user?: AuthUser) {
    return this.svc.resolveConflict(id, dto.resolution, user);
  }
}

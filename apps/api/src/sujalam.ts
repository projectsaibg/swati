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
import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Feature, Public } from './decorators';

const DISCLAIMER =
  'SWATI is architecturally prepared for Sujalam Bharat integration. Official production integration is subject to government API specifications, authorization, credentials, security requirements and data-sharing protocols.';

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
}

@Module({
  providers: [SujalamService],
  controllers: [SujalamController],
  exports: [SujalamService],
})
export class SujalamModule {}

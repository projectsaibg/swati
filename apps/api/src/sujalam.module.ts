/**
 * Sujalam Bharat Integration Layer — Nest module wiring.
 *
 * Kept in its own file so the leaf files don't import each other's module:
 * SyncService (sujalam-sync) depends on SujalamService (sujalam), and defining
 * the module here avoids a circular import that would break DI metadata.
 */
import { Module } from '@nestjs/common';
import { SujalamService, SujalamController } from './sujalam';
import { SyncService, SyncController } from './sujalam-sync';
import { ReportService, ReportController } from './sujalam-reports';

@Module({
  providers: [SujalamService, SyncService, ReportService],
  controllers: [SujalamController, SyncController, ReportController],
  exports: [SujalamService],
})
export class SujalamModule {}

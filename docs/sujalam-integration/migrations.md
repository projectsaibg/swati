# Prisma migrations

SWATI historically provisioned its schema with `prisma db push` (no migration
history). Phase 5 introduces a **formal migration baseline** so deploys are
reproducible instead of relying on schema drift.

## What was added

- `prisma/migrations/0_init/migration.sql` — a from-empty baseline generated from
  the current `schema.prisma` (the entire SWATI schema, including the Sujalam
  Bharat integration tables). Generated with:

  ```bash
  npx prisma migrate diff \
    --from-empty \
    --to-schema-datamodel prisma/schema.prisma \
    --script > prisma/migrations/0_init/migration.sql
  ```

- `prisma/migrations/migration_lock.toml` — pins the provider (postgresql).

## Adopting migrations

**Fresh database (new deploy):**

```bash
npx prisma migrate deploy --schema=prisma/schema.prisma
node dist/scripts/seed.js
```

`migrate deploy` applies `0_init` and records it in `_prisma_migrations`.

**Existing database already provisioned via `db push`** (e.g. the current dev/
demo box): the tables already exist, so **baseline** instead of re-applying —
mark `0_init` as already applied:

```bash
npx prisma migrate resolve --applied 0_init --schema=prisma/schema.prisma
```

After that, future schema changes follow the normal flow:

```bash
# create the next migration from a schema edit
npx prisma migrate dev --name <change> --schema=prisma/schema.prisma
# apply on other environments
npx prisma migrate deploy --schema=prisma/schema.prisma
```

## Notes

- The running demo box in this repo remains on `db push` (already in sync); switch
  it to migrations at the next convenient deploy using the baseline step above.
- Keep `schema.prisma` and the migration history in lockstep — don't hand-edit
  applied migration SQL; create a new migration for further changes.
- The integration tables in `0_init` (IntegrationProvider, EntityMapping,
  SchemeProfile, ServiceArea, SujalGaon, InfrastructureMapping, FieldMapping,
  ValidationRule, RoleMapping, SyncJob, SyncRecord, LegacyImport, GovAuditLog)
  are all additive to the pre-existing SWATI schema.

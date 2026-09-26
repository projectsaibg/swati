# Sujalam Bharat Integration Layer

> **This is a demonstration / architectural-readiness layer. It is NOT an official
> government integration.** No government API is contacted anywhere in this code.
> Every provider is an in-process **mock**, all data is **demo/mock**, and every
> government identifier is obviously synthetic (`SB-WB-*`, `SB-INF-*`, `JJM-ASSET-*`).
> Production integration is subject to Sujalam Bharat API specifications,
> authorization, credentials, security requirements and data-sharing protocols.

The Sujalam Bharat Integration Layer **extends** SWATI (it replaces nothing) so
the platform is architecturally prepared to interoperate with the **Sujalam
Bharat** program and to import from **JJM 1.0** legacy apps. It is behind the
`sujalam_bharat` feature flag; public reads are open, mutations require login.

## Design principles

1. **Extend, never replace.** SWATI operates independently; the integration is
   additive tables + endpoints + one UI screen (`/sujalam`).
2. **Dual identity.** Every entity keeps its SWATI id **and** a separate
   government id, linked through a generic mapping layer — never overwriting one
   with the other.
3. **Provider-agnostic.** Behaviour is data (config rows) + an adapter seam, so a
   second government system is added as configuration + an adapter, not a rewrite.
4. **Mock-first & clearly labelled.** Adapters are mocks; the UI carries a
   DEMO/MOCK banner and disclaimer; nothing claims official status.

## Phases

| Phase | Scope | Key files |
|------|-------|-----------|
| 1 | Foundation: persistence model, read-only overview, demo seed | `sujalam.ts`, `schema.prisma` |
| 2 | Field/schema **mapping engine** + **validation engine** (declarative, provider-agnostic) | `sujalam-engine.ts` |
| GIS | Geolocated asset integration + service-area/village boundaries + map | `sujalam.ts` (`gis`), `SujalamBharat.tsx` |
| 3 | **Bidirectional sync** (push/pull), **conflict management**, **JJM 1.0 import**, adapter + mock API | `sujalam-adapters.ts`, `sujalam-sync.ts` |
| 4 | **Reports** (readiness/sync/JJM/access) + **RBAC** role mapping & geo-scope | `sujalam-reports.ts`, `sujalam-sync.ts` |
| 5 | **Data classification** (PII redaction), docs, formal migrations | `sujalam-classification.ts`, this doc, `prisma/migrations/` |

## Data model (additive)

- **IntegrationProvider** — configured providers (Sujalam Bharat = push+pull mock; JJM 1.0 = pull-only mock).
- **EntityMapping** — generic internal↔external id mapping (the dual-identity engine).
- **SchemeProfile / ServiceArea / SujalGaon / InfrastructureMapping** — the mapped entities, each carrying `swati*Id` + `sujalamBharatId` (+ `externalInfraId` for JJM), GIS (`gisBoundary`, asset `latitude`/`longitude`), and a `mappingStatus`.
- **FieldMapping** — declarative SWATI-field → external-field mappings with a transform.
- **ValidationRule** — declarative validation rules (REQUIRED, REGEX, MIN, MAX, ENUM, LENGTH_MAX, GIS_PRESENT).
- **SyncJob / SyncRecord** — persisted push/pull runs and per-record outcomes (conflicts stored in `SyncRecord.response`).
- **LegacyImport** — JJM 1.0 import batches.
- **RoleMapping** — RBAC: SWATI role → government role + capabilities (push/pull/resolve/import) + geo-scope.
- **GovAuditLog** — audit trail of every sync / import / conflict resolution.

Enums: `IntegrationSystem {SUJALAM_BHARAT, JJM_1_0}`, `SyncDirection {PUSH, PULL}`,
`SyncState`, `MappingStatus`.

## Engines (pure, testable)

- **Mapping** (`sujalam-engine.ts` → `mapEntity`): applies field mappings +
  transforms (`DIRECT, CONSTANT, UPPER/LOWER/TITLECASE, TRIM, DATE_ISO, NUMBER,
  BOOLEAN, MAP`) to build the external payload; reports missing required fields.
- **Validation** (`validateEntity`): evaluates rules; warnings never fail
  validity; a broken rule/transform config degrades safely and never blocks data.

Both are free of Prisma/Nest so they unit-test in isolation and are reused by the
sync runner.

## Sync & conflicts (`sujalam-sync.ts`)

- **Adapter seam** (`sujalam-adapters.ts`): `ProviderAdapter` is what a real API
  would implement. Mocks are deterministic (hashed by internal id).
- **Push**: valid entities → mapped payload → `adapter.push` → mark `SYNCED`
  (external id assigned when absent) or `FAILED`; invalid ones rejected pre-push.
- **Pull**: the mock provider proposes government-side field changes; matches
  refresh, differences become field-level **conflicts** (`mappingStatus → CONFLICT`).
- **Conflict resolution**: keep-SWATI or take-provider; only ever writes the one
  sanctioned conflict field per entity type (defense-in-depth); audit-logged.
- **JJM 1.0 import**: pull the legacy asset inventory; link existing by external
  id or create new (idempotent upsert).

## RBAC (role mapping + geo-scope)

`RoleMapping` maps each SWATI role to a government counterpart and the
capabilities it may exercise, with an optional **geo-scope** (a district, or
`ALL`). Enforced by the sync layer **on top of** the base `data.enter`
permission; `GET /sujalam/my-access` resolves the caller's capabilities so the UI
gates each action. Administrators (`*`) get full access.

Seeded matrix (demo):

| SWATI role | Government role | Push | Pull | Resolve | Import | Scope |
|---|---|---|---|---|---|---|
| Administrator | State Administrator | yes | yes | yes | yes | ALL |
| Executive Engineer | District Nodal Officer | yes | yes | yes | yes | ALL |
| Assistant Engineer | Block Coordinator | no | yes | yes | no | Nadia |
| Field Officer | Field Enumerator | no | no | no | no | Purba Medinipur |

## Data classification (PII protection)

`sujalam-classification.ts` classifies every field:

- **PUBLIC** — ids, names, geography, status, GIS: visible on public reads.
- **INTERNAL** — demographic aggregates (`population`): signed-in only.
- **SENSITIVE** — household-level counts (`households`, `fhtc`, `targetHouseholds`):
  signed-in only, **redacted from public interfaces**.

The `map-preview` endpoint redacts non-PUBLIC fields for anonymous viewers; the
Field Mapping UI badges each field's classification. (The demo's finest grain is
village/area aggregates — there is no individual PII — but the framework protects
real household data the same way.)

## Endpoints

Reads (`@Public`, feature-gated):
`GET /api/sujalam/overview | providers | mappings | field-mappings | validation-rules | map-preview | validation-report | gis | classification | sync/jobs | conflicts | my-access | reports | reports/readiness | reports/sync-activity | reports/jjm-migration | role-mappings`

Mutations (`@Perm('data.enter')` + RBAC capability):
`POST /api/sujalam/sync/push | sync/pull | import/jjm | conflicts/:id/resolve`

## Running locally

The API image builds the Prisma client and compiles `dist` (including the seed).

```bash
docker compose build api && docker compose up -d api
docker compose exec api npx prisma db push --schema=prisma/schema.prisma --skip-generate --accept-data-loss
docker compose exec api node dist/scripts/seed.js
```

The seed creates 2 mock providers, 3 schemes, 10 service areas, 25 villages, 100
assets, field mappings, validation rules and role mappings — spanning both
districts so geo-scope and district reports are meaningful.

See [migrations.md](./migrations.md) for the formal Prisma migration workflow.

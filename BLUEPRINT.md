# SWATI — Engineering Build Blueprint (dev handoff)

This is the executable spec for building SWATI on the foundation in this repo.
Read `README.md`, `../AUDIT_PHASE1.md` (decisions), and `prisma/schema.prisma`
(data model) first. Everything here is Phase 1 unless marked Phase 2+.

Stack (locked): Vite+React+TS (web) · NestJS+Prisma (api) · PostgreSQL+TimescaleDB
· Redis · MinIO · Caddy · Docker Compose on one box (Hostinger KVM 4 showcase,
on-prem production).

---

## 1. Monorepo & conventions

```
swati-ts/
  apps/api      NestJS (TypeScript, Prisma)
  apps/web      Vite + React + TS
  packages/types  shared DTO/enum types (imported by api + web)
  packages/esa    ESA DSP engine (pure TS, WASM FFT) — unit tested standalone
  prisma/         schema + migrations + seed
  infra/, docker-compose.yml, .env.example
```
- Package manager: pnpm workspaces. Node 20 LTS. TypeScript strict.
- Lint/format: ESLint + Prettier. Commit hooks: lint-staged + typecheck.
- Tests: Vitest (unit), Supertest (api integration), Playwright (e2e).
- Shared types live in `packages/types` and are the single source of truth for
  DTOs and enums across api and web. Do not duplicate.

---

## 2. Feature registry (canonical)

Every feature has a stable `key`. Tier sets the default preset (cumulative);
admin overrides `enabled` and `visibility` per deployment. Defaults below.

| key | Module | Tier | Default visibility |
|---|---|---|---|
| executive_overview | Executive Overview | Base | PUBLIC |
| interactive_map | Interactive Map | Base | PUBLIC |
| action_center | Action Center | Base | LOGIN |
| network_analysis | Network Analysis | Base | LOGIN |
| communication | Communication | Base | LOGIN |
| accountability | Accountability | Base | LOGIN |
| field_verification | Field Verification | Base | LOGIN |
| reports | Reports | Base | LOGIN |
| key_personnel | Key Personnel | Base | LOGIN |
| water_quality | Water Quality | Vector | PUBLIC (overview), detail LOGIN |
| nrw_explorer | NRW Explorer | Vector | LOGIN |
| valve_control | Valve Control | Vector | LOGIN |
| leak_detection | ILK Hunter | Velocity | LOGIN |
| billing | Billing & Revenue | Velocity | LOGIN |
| maintenance | Maintenance (Preventive) | Velocity | LOGIN |
| condition_monitoring | Pump/Motor ESA | Velocity | PUBLIC (overview), detail LOGIN |
| predictive | Predictive Analysis | Quantum | LOGIN |
| chatbot | AI Assistant | Quantum | LOGIN |
| digital_twin | Digital Twin | Quantum | PUBLIC |
| admin_panel | Admin | Admin | LOGIN (admin role only) |

Tier presets: BASE = all Base keys on. VECTOR = BASE + Vector. VELOCITY = VECTOR +
Velocity. QUANTUM = VELOCITY + Quantum. Seed writes one FeatureFlag row per key
per deployment from the tier, then admin toggles.

Open item for stakeholders: confirm which keys are PUBLIC vs LOGIN on the
internet-facing view (defaults above are the safe starting point).

---

## 3. AuthN / AuthZ

- **AuthN:** email + password (Argon2id hash). JWT access token (15 min) returned
  to the SPA; refresh token (7 day) in an httpOnly, Secure, SameSite=Strict cookie.
  `/api/auth/refresh` rotates. Login rate-limited (e.g. 5/min/IP) + lockout.
- **Roles & permissions:** `Role` has `rank` (escalation ladder) and `permissions`
  (string keys). Permission keys: `feature.act`, `valve.operate`, `alert.ack`,
  `data.enter`, `gis.import`, `comms.send`, `users.manage`, `roles.manage`,
  `features.manage`, `config.manage`. Bundle into role presets:
  - Viewer (implicit, no login): read PUBLIC features only.
  - Operator: `feature.act`, `alert.ack`, `data.enter`, `comms.send`,
    `gis.import`, and `valve.operate` if granted.
  - Manager: Operator + team oversight (see comms) + higher rank.
  - Admin: everything incl. `*.manage`.
- **Guards (NestJS):**
  - `@Public()` — no auth (public GETs).
  - `JwtAuthGuard` — requires a valid access token.
  - `RolesGuard` + `@Perm('valve.operate')` — permission check.
  - `FeatureGuard` + `@Feature('valve_control')` — 404/403 if the feature is
    disabled for the deployment. **Applies to public GETs too**: a LOGIN-visibility
    feature's data is never returned without auth even if hidden in the UI.
- **Rule:** all writes/controls require JwtAuthGuard + the right `@Perm`. The
  public view is read-only. Enforce on the server; UI hiding is cosmetic.

---

## 4. API contract

Base: `/api`. JSON. Conventions:
- **Pagination:** `?page=1&pageSize=25` -> `{ data: [], page, pageSize, total }`.
- **Errors:** `{ statusCode, error, message }` (no stack/internal leakage). One
  global exception filter.
- **Validation:** class-validator DTOs in `packages/types`; whitelist + forbid
  unknown props.
- **Timestamps:** ISO-8601 UTC.

### Core platform endpoints
```
POST /api/auth/login            {email,password} -> {accessToken, user}
POST /api/auth/refresh          (cookie) -> {accessToken}
POST /api/auth/logout
GET  /api/auth/me               -> current user + role + permissions

GET  /api/public/features       -> [{key, visibility}] for ENABLED features only (no auth)
GET  /api/admin/features        (admin) -> full flag list
PATCH/api/admin/features/:key   (admin) {enabled?, visibility?}
PUT  /api/admin/tier            (admin) {tier} -> re-applies preset (keeps overrides)

GET/POST/PATCH /api/admin/users         (users.manage)
GET/POST/PATCH /api/admin/roles         (roles.manage)  // ladder: rank, reportsToId, permissions
GET/PATCH      /api/admin/settings      (config.manage) // AppSetting kv
```

### Domain resources (feature-gated)
Assets/readings/alerts (condition_monitoring, executive_overview):
```
GET  /api/assets                 filter type,status,site; paginated
GET  /api/assets/:id             + latest reading + computed health
POST /api/assets                 (data.enter)
GET  /api/assets/:id/readings    ?from&to&limit  (time-series)
POST /api/readings               (data.enter | api-key)  single or batch
POST /api/ingest                 (api-key)  device/SCADA push (Phase 2 uses MQTT->this)
GET  /api/alerts                 filter status,severity; paginated
PATCH/api/alerts/:id             (alert.ack) {status}
```
Each other module = standard CRUD + a KPI/summary endpoint, feature-gated:
`water_quality`, `nrw`, `valves` (+ `POST /:id/operate` guarded by `valve.operate`),
`maintenance`, `leak_detection`, `network`, `billing`, `accountability`,
`personnel`, `reports`, `field_verification`. Derive fields from `schema.prisma`.

### Communication (chain of command)
```
GET  /api/messages/inbox         messages to me, threaded
GET  /api/messages/sent
POST /api/messages               (comms.send) {subject,body,area?,assetTag?,attachments?}
                                 -> recipient resolved server-side (see 8)
PATCH/api/messages/:id           {status: READ|ACKNOWLEDGED|ESCALATED}
```

### Evidence attachments
```
POST /api/attachments            multipart (auth): file + ownerType + ownerId
                                 -> extract EXIF/GPS, record server uploadedAt,
                                    watermark, store in MinIO, return metadata
GET  /api/attachments/:id/url    -> short-TTL presigned GET URL
```

### GIS
```
POST /api/gis/preview            (gis.import) upload xls/csv/kml -> parsed columns + sample rows
POST /api/gis/import             (gis.import) {mapping, name} -> GeoJSON stored as GisLayer
GET  /api/gis/layers             -> layer list
GET  /api/gis/layers/:id         -> GeoJSON
```

### ESA / Predictive
```
POST /api/esa/analyze            (data.enter|api-key) {assetId, signal|readingRef} -> indices+spectra
GET  /api/predictive/forecast    -> per-asset risk (health trend -> days-to-threshold)
```

---

## 5. Web app (apps/web)

- **Routing:** React Router. On load, fetch `/api/public/features`; build nav +
  routes ONLY for enabled features. LOGIN-visibility features render a sign-in
  prompt until authenticated. Disabled deep-link -> redirect to `/`.
- **Layout:** left sidebar, grouped (Overview · Assets · Operations · Water ·
  Commercial · People/Comms · Reports · Admin), collapsible. (Fixes the nav
  overload seen in earlier versions.)
- **Public vs app:** the shell is public/read-only; login unlocks writes, LOGIN
  features, and `/admin`.
- **Admin panel (`/admin`, admin role):** feature switchboard (enabled +
  visibility per key), tier selector, role-ladder editor, user & manager
  assignment, settings.
- **Design system:** Tailwind + Radix (shadcn). One accent, elevation tokens,
  dark + light. Real display typeface + tabular-nums for all metrics. Follow the
  design direction in the earlier review (calm ops console, not marketing).
- **KPIs (visual effects):** Recharts/visx + Framer Motion — animated count-ups,
  gauges, sparklines with delta arrows, status pills (OK/Watch/Alarm/Critical).
- **Maps:** Leaflet for 2D; **Cesium/Resium** for the 3D map + digital twin.
  Self-host tiles/terrain (air-gap-safe). Layers: assets (health-colored),
  valves, ILK, field points, imported GIS layers; drag-to-move + click-to-place
  (writes require auth).
- **Data layer:** one typed API client (generated from OpenAPI or hand-typed from
  `packages/types`) with auth interceptor + refresh.

---

## 6. ESA / predictive engine (packages/esa)

The differentiated core. Pure-TS package, WASM FFT for speed, unit-tested against
synthetic signals. Phase 1 runs on recorded/demo signals; Phase 2 feeds live SCADA.

**Inputs:** per-phase current (and voltage if available) time-domain samples +
sample rate; motor nameplate (poles, rated Hz, rated rpm, rated V/A). For assets
without raw waveforms, accept the derived indices directly (as the demo data does).

**Pipeline:**
1. Preprocess: detrend, Hann window, optional resample.
2. FFT (WASM, e.g. kissfft/pffft port) -> current/voltage spectra.
3. Estimate line freq `f`, slip `s`, rotational freq `f_r`.
4. Fault features (map to sub-indices, higher = healthier):
   - **Rotor bar** (rotor_index): sideband amplitude at `(1 ± 2ks)f` vs fundamental.
   - **Bearing** (bearing_index): envelope/Hilbert demodulation; energy at BPFO/
     BPFI/BSF/FTF from bearing geometry (or generic bands if geometry unknown).
   - **Eccentricity/misalignment** (eccentricity_index): sidebands at `f ± k·f_r`.
   - **Stator** (stator_index): negative-sequence, specific slot harmonics.
   - **Supply** (supply_index): voltage/current unbalance, THD (3,5,7,...),
     interharmonics.
   - **Load** (load_index): low-freq load modulation.
5. Direct KPIs: RMS I/V, power, PF, efficiency estimate, THD, unbalance, vibration
   RMS (ISO 10816 zones).
6. **Health score:** weighted mean of the six sub-indices minus penalties for
   out-of-range KPIs. Port thresholds/weights from the validated PHP `kpi.php`
   (Supply/Stator/Rotor/Eccentricity/Load/Bearing taxonomy).
7. **Predictive:** trend health/sub-indices over time -> linear projection of
   days-to-threshold + risk band. Advanced ML fault classification = Python
   microservice, Phase 2+ (documented exception), not now.

**Outputs:** per-reading sub-indices, health, fault flags, and spectra arrays for
charts. **Tests:** inject a known sideband/bearing tone into a synthetic signal
and assert the right index drops and the right flag fires.

---

## 7. GIS import (xls / csv / kml)

- Parse: `xlsx` (SheetJS) for .xls/.xlsx and .csv; `@tmcw/togeojson` for .kml/.kmz;
  accept raw .geojson.
- `POST /gis/preview` returns detected columns + sample rows. The web shows a
  **column-mapping** step: choose lat/lng (or easting/northing + CRS via proj4),
  name, type, and keep other columns as properties.
- `POST /gis/import` builds a GeoJSON FeatureCollection, validates coordinate
  bounds/CRS (WGS84 default), stores it as `GisLayer.geojson`.
- Render as toggleable layers on Leaflet + Cesium. Markers styled by status/health.

---

## 8. Chain-of-command communication

- **Recipient resolution (server-side):** if sender has `manager_id`, that user;
  else find users whose `role` == sender.role.reportsTo (the next rank up) and
  deliver to that role's inbox (all holders, or a designated one — config).
- **Statuses:** SENT -> READ -> ACKNOWLEDGED; ESCALATED bumps to the next rank up.
- **Phase 1:** manual send/ack/escalate. **Phase 2:** auto-escalation on SLA
  timeout via a Redis-backed worker (BullMQ).
- Messages can carry evidence attachments (section 4) and link to an asset/area.

---

## 9. Non-functional

- **Security:** server-side feature + permission enforcement on every route;
  Argon2id; JWT rotation; helmet; strict CORS to PUBLIC_BASE_URL; input
  validation; presigned URLs (short TTL); audit log for privileged actions
  (valve ops, config, role changes). Never expose DB/Redis/MinIO publicly.
- **Performance:** pagination everywhere; TimescaleDB hypertable + compression +
  retention on `readings`; indexes per `schema.prisma`; cache the feature config
  in Redis and invalidate on admin change.
- **Observability:** pino structured logs; Sentry; `/health` + `/ready`.
- **CI (GitHub Actions):** install -> typecheck -> lint -> unit -> integration ->
  build web + api images. Block merge on red.
- **Backups:** nightly pg_dump + MinIO mirror (see DEPLOY runbook); test restores.

---

## 10. Build order (milestones + acceptance criteria)

- **M1 API core:** auth + RBAC guards + FeatureGuard + `/public/features` +
  `/admin/features` + `/admin/tier` + seed (deployment, tiers, admin, demo data).
  *Accept:* login works; toggling a flag changes `/public/features`; disabled
  feature routes 403/404 even with a direct call.
- **M2 Web shell:** dynamic nav/routes from features; login; admin switchboard +
  tier selector + role/user editor. *Accept:* enabling a feature in admin makes it
  appear in nav after refresh; LOGIN features hidden from public.
- **M3 Base modules:** Executive Overview, Interactive Map (Leaflet), Action
  Center, Reports, Accountability, Field Verification, Communication (manual
  chain), Key Personnel, Network Analysis. *Accept:* each renders demo data,
  writes require login.
- **M4 Vector + Velocity + Quantum modules** (port PHP logic): Water Quality, NRW,
  Valve Control (+operate), ILK, Billing, Maintenance, Condition Monitoring,
  Predictive, Chatbot. *Accept:* parity with the PHP demo, per-tier gating works.
- **M5 Evidence pipeline:** photo upload + EXIF/GPS + watermark + MinIO + presigned
  serving, wired into Reports + Field Verification + Messages. *Accept:* uploaded
  photo shows authoritative timestamp + location watermark.
- **M6 GIS import:** xls/csv/kml -> mapping -> GeoJSON -> map layers. *Accept:*
  a sample spreadsheet of assets appears as points on the map.
- **M7 ESA engine:** `packages/esa` with tested DSP; wire `/esa/analyze` +
  `/predictive/forecast`. *Accept:* synthetic broken-bar signal is detected;
  predictive ranks the degrading demo assets.
- **M8 Cesium 3D + digital twin overlay:** 3D map with self-hosted tiles/terrain,
  assets bound to live health, GIS layers in 3D. *Accept:* 3D map loads with
  health-colored assets; digital_twin feature gate works.
- **M9 Harden + ship:** CI green, tests, security review, deploy to KVM 4 per the
  runbook, stakeholder QC.

Phase 2+ (separate architecture doc, after QC): MQTT/SCADA ingestion (OPC-UA/
Modbus), auto-escalation worker, Python ML analytics service, EPANET network twin,
paid notification channels (Email/SMS/WhatsApp) wiring.

---

## 11. Definition of done (Phase 1 QC checklist)
- [ ] All enabled modules work on demo data; per-tier + per-feature toggles work.
- [ ] Public view read-only; every write/control + admin behind login; enforced
      server-side (verified by direct API calls, not just UI).
- [ ] Role ladder + per-user override; chain-of-command comms send/ack/escalate.
- [ ] Evidence photos: server timestamp + EXIF/GPS + watermark.
- [ ] GIS xls/csv/kml import onto the map.
- [ ] ESA detects seeded faults; predictive ranks risk.
- [ ] Deployed on KVM 4 over HTTPS; backups running; CI green; no known security holes.

---

## 12. Open items for stakeholders / dev lead
1. Confirm the PUBLIC vs LOGIN visibility set (section 2 defaults).
2. Chatbot: which LLM provider + data-handling policy (on-prem/self-hosted model
   vs external API — matters for sovereignty).
3. Digital twin scope: Cesium overlay of live telemetry now vs full 3D equipment
   models later.
4. Phase 2 SCADA specifics: protocols in the field (OPC-UA / Modbus / MQTT) and a
   sample data source to build the connector against.
5. Paid channels: chosen Email/SMS/WhatsApp providers (for Phase 2 wiring).
6. Map tiles: which region/extent to self-host (storage sizing).

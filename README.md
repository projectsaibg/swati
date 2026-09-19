# SWATI — uniform TypeScript platform

Water-utility operations platform. Proprietary product of EPP.
Uniform TypeScript across the stack, one on-prem/VPS box, no hyperscaler.

## Stack
- **Web:** Vite + React + TypeScript + React Router; Cesium (3D map), Three.js
  (asset twin), Recharts/visx + Framer Motion (animated KPIs), Tailwind + Radix.
- **API:** NestJS (TypeScript) + Prisma.
- **Data:** PostgreSQL + TimescaleDB (readings hypertable).
- **Storage:** MinIO (S3-compatible) for evidence photos.
- **Cache/queue:** Redis (+ workers, Phase 2).
- **Proxy/TLS:** Caddy.
- **Ship:** Docker Compose on one box (Hostinger KVM 4 for showcase; on-prem for
  production).

## Monorepo layout
```
swati-ts/
  prisma/schema.prisma        data model (entitlements, roles, assets, readings, ...)
  docker-compose.yml          full stack, sized for KVM 4 (4 vCPU / 16 GB)
  infra/Caddyfile             reverse proxy + TLS
  .env.example                copy to .env
  apps/
    api/                      NestJS API            (next chunk)
    web/                      Vite/React SPA         (next chunk)
  packages/
    types/                    shared TS types        (next chunk)
  DEPLOY_HOSTINGER_KVM4.md    server setup + deploy runbook
```

## Locked design decisions (see ../AUDIT_PHASE1.md)
- Public frontend has **no viewer login**; every write/control action and the
  admin panel require login. Enforced server-side.
- **Feature entitlements + tiers:** Base (always on) -> Vector -> Velocity ->
  Quantum (cumulative), with a **per-feature switch** and **per-feature visibility**
  (public vs login-to-view) in the admin panel.
- **Role ladder** (rank + reports_to) with **per-user manager override**.
- **Chain-of-command** messaging; **evidence photos** with authoritative server
  timestamp + EXIF/GPS + watermark, stored in MinIO.
- **GIS import:** XLS/CSV/KML -> GeoJSON on the map.
- **ESA/predictive:** real DSP in TypeScript/WASM; Python service only later if ML
  demands it.

## Build status
- [x] Foundation: data model, Docker stack (KVM 4), Caddy, env, deploy runbook.
- [ ] API skeleton (NestJS: auth + features/entitlements + health) — next.
- [ ] Web skeleton (Vite/React: dynamic nav from /features, admin switchboard).
- [ ] Modules ported (Base, then Vector, Velocity, Quantum).
- [ ] GIS XLS/CSV/KML import + map.
- [ ] ESA DSP engine (TS/WASM).
- [ ] Cesium 3D map + digital-twin overlay.
- [ ] CI + tests.

## Local dev (once app code lands)
```bash
cp .env.example .env      # fill in secrets
docker compose up -d db redis minio
cd apps/api && npm ci && npx prisma migrate dev && npm run start:dev
cd apps/web && npm ci && npm run dev
```

## Deploy
See `DEPLOY_HOSTINGER_KVM4.md`.

# SWATI — M1 + M2 Verification Runbook

Goal: turn the hand-written M1 (API) + M2 (web) code into a **known-green** base:
it installs, compiles, runs, and the acceptance checks pass. Follow every step in
order. Nothing here adds product features; it only builds and verifies what exists.

Primary path runs the **API in Docker** (Linux — avoids Windows native-build
issues like `argon2`) and the **web dev server on the host**. Works on Windows
11 (your machine) and on the Ubuntu server identically.

---

## 0. Prerequisites (install once)

On the machine you verify on:

1. **Docker Desktop** (Windows: with WSL2 backend) — start it and wait until it
   says "Engine running". Verify:
   ```
   docker --version
   docker compose version
   ```
2. **Node.js 20 LTS** (for building the web app). From nodejs.org, then verify:
   ```
   node --version   (should print v20.x)
   ```
3. **pnpm** via Corepack (ships with Node):
   ```
   corepack enable
   pnpm --version
   ```
4. **Git**:
   ```
   git --version
   ```

If any command is "not recognized", install that tool before continuing.

---

## 1. Put the code in a git repo

From the folder that contains `swati-ts/`:
```
cd swati-ts
git init
git add .
git commit -m "chore: import SWATI foundation + M1 API + M2 web"
```
(You can push to a private GitHub/GitLab repo now or later.)

---

## 2. Create the environment files

### 2a. Root `.env` (used by Docker Compose + the API container)
```
cd swati-ts
copy .env.example .env        # Windows
# cp .env.example .env         # macOS/Linux
```
Open `.env` and set real values. Generate the two JWT secrets with Node:
```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Run it twice; paste one value into `JWT_ACCESS_SECRET`, the other into
`JWT_REFRESH_SECRET`. Set a strong `POSTGRES_PASSWORD` and `MINIO_ROOT_PASSWORD`,
and make sure `DATABASE_URL` uses those same values with host **`db`** (the
compose service name), e.g.:
```
DATABASE_URL=postgresql://swati:YOURPASS@db:5432/swati?schema=public
PUBLIC_BASE_URL=http://localhost:5173
```
Leave `PUBLIC_BASE_URL` as `http://localhost:5173` for local verification (that is
the web dev server origin; it makes CORS + cookies work over http).

### 2b. Dev override — create `swati-ts/docker-compose.override.yml`
This publishes the internal ports to your host for local dev and runs the API in
**development** mode (so the refresh cookie is not `Secure`-only and works over
plain http). Create the file with exactly this content:
```yaml
services:
  api:
    environment:
      NODE_ENV: development
    ports:
      - "3000:3000"
  db:
    ports:
      - "5432:5432"
  redis:
    ports:
      - "6379:6379"
  minio:
    ports:
      - "9000:9000"
      - "9001:9001"
```
Docker Compose merges this automatically with `docker-compose.yml`. Delete it
before a production deploy (production keeps those ports internal).

---

## 3. Build + start the backend (Docker)

From `swati-ts/`:
```
docker compose up -d --build db redis minio
docker compose up -d --build api
```
- The `--build api` step compiles the NestJS code (`nest build`) **inside the
  image**. If M1 has TypeScript errors, this step fails and prints them.
  -> If it fails: run `docker compose build api` again to see the full log,
     copy the errors, and send them to me (see section 8). Do not continue until
     `api` builds.
- Check everything is up and healthy:
  ```
  docker compose ps
  ```
  `db` should be `healthy`; `api`, `redis`, `minio` `running`.

---

## 4. Create the database schema + seed

The repo has no migration files yet, so use Prisma **db push** for first bring-up
(it creates the tables directly from the schema). Run inside the api container:
```
docker compose exec api npx prisma db push --schema prisma/schema.prisma
```
Expected: "Your database is now in sync with your Prisma schema."

> HYPERTABLE NOTE — SKIP FOR NOW. The `readings` table is a normal table for M1/M2.
> Do NOT run `create_hypertable` yet: the `Reading` model's primary key is `id`
> (not `ts`), and TimescaleDB refuses a hypertable whose unique key omits the time
> column. Converting `readings` to a hypertable is a Phase-2 change (make the PK
> composite `(id, ts)` first). It is not needed to verify M1/M2.

Seed the deployment, feature flags, role ladder, admin user, and demo data:
```
docker compose exec api node dist/scripts/seed.js
```
Copy the printed **admin email** (`admin@swati.local`) and the **one-time admin
password** from the output. If you miss it, re-run the seed (it only regenerates
the password if the user does not already exist — otherwise reset via the DB).

---

## 5. Verify the API (before touching the web app)

Health (should print `{"status":"ok"}`):
```
curl http://localhost:3000/api/health
```
Public features (should print a JSON array of enabled features — Vector tier):
```
curl http://localhost:3000/api/public/features
```
Login (replace PASSWORD with the seeded one). Windows PowerShell:
```
curl.exe -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@swati.local\",\"password\":\"PASSWORD\"}"
```
Expected: JSON with `accessToken` and `user`. Copy the `accessToken` value, then
check an admin-only route (replace TOKEN):
```
curl.exe http://localhost:3000/api/admin/features -H "Authorization: Bearer TOKEN"
```
Expected: the full feature list with `enabled`/`visibility`. A call **without**
the token should return 401 — that confirms server-side auth is enforced.

If any of these error at runtime (not just wrong data), capture the response and
`docker compose logs api`, and send them to me.

---

## 6. Build + run the web app (host)

New terminal:
```
cd swati-ts/apps/web
pnpm install
pnpm dev
```
- `pnpm install` on Windows is fine (web has no native modules).
- If TypeScript errors appear on `pnpm dev` or `pnpm build`, copy them and send
  to me.
- Open **http://localhost:5173**. The Vite dev server proxies `/api` to the
  API on :3000.

---

## 7. Acceptance checklist (this is "green")

Do these in the browser at http://localhost:5173:

- [ ] The page loads and shows the sidebar with only the **Vector-tier** features
      (Executive Overview, Interactive Map, Water Quality, plus the public ones).
- [ ] Public (not logged in) view shows only PUBLIC features; LOGIN-only ones are
      hidden.
- [ ] Click **Sign in**, log in as `admin@swati.local` + seeded password. More
      nav items appear (LOGIN features) and an **Admin panel** link shows.
- [ ] Open **Admin panel**. Toggle a disabled feature ON (e.g. `billing`). It
      appears in the sidebar without a full reload.
- [ ] In Admin, change a feature's visibility PUBLIC <-> LOGIN and confirm the
      nav reflects it.
- [ ] Apply a different **tier** (e.g. QUANTUM) and confirm more features enable.
- [ ] Sign out — LOGIN features and the Admin link disappear.

If all boxes tick, **M1 + M2 are verified green.** Commit:
```
cd swati-ts && git add -A && git commit -m "chore: M1+M2 verified locally"
```

---

## 8. If something breaks — how to report it to me

Send me, as text (not screenshots where possible):
1. Which step number failed.
2. The exact command you ran.
3. The full error output (from the terminal, or `docker compose logs api`).

I will send back the specific file + line fix. Fastest loop: batch all the
compile errors from one `docker compose build api` (and one web `pnpm build`) and
paste them together.

---

## 9. Troubleshooting (anticipated issues)

| Symptom | Cause | Fix |
|---|---|---|
| `nest build` fails in `docker compose build api` | TS error in M1 (expected on first pass) | Copy errors, send to me |
| Web `pnpm dev` shows TS errors | TS error in M2 | Copy errors, send to me |
| `argon2` fails to build during `pnpm install` on host | Windows native build | You run the API in Docker (Linux), so do NOT `pnpm install` in `apps/api` on Windows — let the container build it. Only `apps/web` is installed on host. |
| Prisma: "Can't reach database server at db:5432" | Running prisma outside the container, or db not up | Run prisma via `docker compose exec api ...` (as shown); confirm `docker compose ps` shows db healthy |
| Login works but you get logged out on refresh | `Secure` cookie over http | Ensure the override sets `NODE_ENV: development` for `api` and you're on http://localhost:5173 |
| `create_hypertable` error about unique index | PK omits `ts` | Skip the hypertable (see the note in step 4); it's Phase 2 |
| Port already in use (5432 / 3000 / 9000) | Another service (e.g. a local Postgres) | Change the left-hand port in `docker-compose.override.yml` (e.g. `"5433:5432"`) and reuse it |
| Vite proxy `ECONNREFUSED /api` | API not on :3000 | `docker compose ps`; ensure the override published `3000:3000` and `api` is running |
| CORS error in browser console | `PUBLIC_BASE_URL` mismatch | Set `PUBLIC_BASE_URL=http://localhost:5173` in `.env`, then `docker compose up -d api` |

---

## 10. Optional: production-style smoke test (later)
To test the full prod path (Caddy + built web + HTTPS), you need a real domain and
the steps in `DEPLOY_HOSTINGER_KVM4.md`. That is the go-live procedure, not needed
for M1/M2 verification. Do the dev-loop verification above first.

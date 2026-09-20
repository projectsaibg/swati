# Deploying SWATI to Hostinger KVM 4

Target box: **Hostinger KVM 4 — 4 vCPU / 16 GB RAM / 200 GB NVMe**, Ubuntu 24.04 LTS,
Mumbai region. Everything runs in Docker on this one server (web, API,
PostgreSQL/TimescaleDB, Redis, MinIO, Caddy). No external cloud.

## 0. Before you start
- A domain (or subdomain) pointing an **A record** at the VPS public IP (needed for
  automatic HTTPS). e.g. `swati.yourdomain.in -> <VPS IP>`.
- SSH access to the VPS (Hostinger gives you root + IP + password/key).

## 1. Provision the VPS
1. In hPanel, create the KVM 4 VPS, OS = **Ubuntu 24.04 LTS**, region **Mumbai**.
2. Set a strong root password / add your SSH key.
3. SSH in: `ssh root@<VPS IP>`.

## 2. Base hardening (10 min)
```bash
adduser swati && usermod -aG sudo swati        # non-root user
# add your SSH key for 'swati', then disable root/password SSH in /etc/ssh/sshd_config
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
apt update && apt -y upgrade
unattended-upgrades                             # keep security patches current
```
Only 22/80/443 are open. Postgres, Redis, and MinIO are never exposed publicly.

## 3. Install Docker
```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker swati
```
Log out/in as `swati` so the group applies.

## 4. Get the code + configure
```bash
git clone <your-repo-url> swati && cd swati
cp .env.example .env
# edit .env: strong POSTGRES_PASSWORD, MINIO password, and:
#   openssl rand -hex 32   -> JWT_ACCESS_SECRET
#   openssl rand -hex 32   -> JWT_REFRESH_SECRET
# set PUBLIC_BASE_URL=https://swati.yourdomain.in
nano .env
# set your real domain in infra/Caddyfile (replace swati.example.com)
nano infra/Caddyfile
```

## 5. Build the web bundle
The web app is served as static files by Caddy from `apps/web/dist`.
Either build on the box (needs Node 20) or build in CI and copy `dist` up.
```bash
# on the box:
cd apps/web && npm ci && npm run build && cd ../..
```

## 6. Start the stack
```bash
docker compose up -d --build
docker compose ps                # all healthy?
```

## 7. Initialise the database (first run only)
```bash
# apply the Prisma schema
docker compose exec api npx prisma migrate deploy
# turn the readings table into a Timescale hypertable + compression
docker compose exec db psql -U swati -d swati -c "SELECT create_hypertable('readings','ts', migrate_data => true);"
# seed demo data + the first admin (interactive script prints the admin password once)
docker compose exec api node dist/scripts/seed.js
```

## 8. Verify
- `https://swati.yourdomain.in` -> public read-only view loads (enabled features only).
- `https://swati.yourdomain.in/admin` -> admin login -> feature switchboard.
- `docker compose logs -f api` -> no errors.

## 9. Backups (set up on day one)
```bash
# nightly DB dump + MinIO copy to /backups (add to crontab -e)
0 2 * * * docker compose exec -T db pg_dump -U swati swati | gzip > /backups/swati-$(date +\%F).sql.gz
0 3 * * * docker compose exec -T minio mc mirror /data /backups/minio   # or restic to offsite
```
Copy `/backups` offsite per your policy. Test a restore before go-live.

## 10. Updates
```bash
git pull
cd apps/web && npm ci && npm run build && cd ../..
docker compose up -d --build
docker compose exec api npx prisma migrate deploy
```

## Sizing notes (KVM 4)
- Memory budget (16 GB): db 6 GB, api 2 GB, minio 1 GB, redis 0.5 GB, caddy 0.25 GB,
  OS + headroom ~6 GB. Comfortable for the showcase and early real use.
- Watch disk: time-series + evidence photos grow. Enable TimescaleDB compression
  and a retention policy; keep an eye on `df -h`. Move to a bigger plan or add a
  volume when NVMe fills.
- Heavy Phase 2 IoT volume or many concurrent 3D users -> add vCPU/RAM (resize plan)
  or split DB onto its own box.

## Production note
This VPS is ideal for the **showcase**. The government **production** deployment is
on-premise / in-country per the plan — same Docker stack, run on the department's
own hardware.

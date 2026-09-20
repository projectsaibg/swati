# SWATI API image. Build context is the repo root (see docker-compose.yml)
# so the shared Prisma schema at ./prisma is available.
# node:20-slim (Debian) is used because Prisma's query engine needs libssl,
# which Alpine (musl/OpenSSL3) does not provide as libssl.so.1.1.

FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY apps/api/package.json ./
RUN npm install
COPY prisma ./prisma
RUN npx prisma generate --schema=prisma/schema.prisma
COPY apps/api/tsconfig.json apps/api/nest-cli.json ./
COPY apps/api/src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY apps/api/package.json ./
EXPOSE 3000
CMD ["node", "dist/main.js"]

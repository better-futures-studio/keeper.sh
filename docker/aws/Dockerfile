# syntax=docker/dockerfile:1.19@sha256:b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6
FROM oven/bun:1.3.11-slim@sha256:478281fdd196871c7e51ba6a820b7803a8ae97042ec86cdbc2e1c6b6626442d9 AS base
WORKDIR /app

FROM base AS prune
RUN bun install --global turbo@2.9.0
COPY . .
RUN turbo prune @keeper.sh/api @keeper.sh/cron @keeper.sh/worker @keeper.sh/web --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile
COPY --from=prune /app/out/full/ .
RUN bun run --cwd services/api build && \
    bun run --cwd services/cron build && \
    bun run --cwd services/worker build && \
    bun run --cwd applications/web build

FROM base AS runtime-dependencies
COPY --from=prune /app/out/json/ .
RUN bun install --frozen-lockfile --production

FROM base AS runtime
USER root
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends ca-certificates curl bash \
    && rm -rf /var/lib/apt/lists/*
# Keep build tools in the dependency stage, out of the deployed filesystem.
# The compiled app and Drizzle's SQL migrator do not execute these tools.
COPY --from=runtime-dependencies \
    --exclude=**/node_modules/esbuild \
    --exclude=**/node_modules/@esbuild \
    --exclude=**/node_modules/@esbuild-kit \
    --exclude=**/node_modules/drizzle-kit \
    --exclude=**/node_modules/.bin/esbuild \
    --exclude=**/node_modules/.bin/drizzle-kit \
    /app/ /app/
COPY --from=build /app/services/api/dist ./services/api/dist
COPY --from=build /app/services/cron/dist ./services/cron/dist
COPY --from=build /app/services/worker/dist ./services/worker/dist
COPY --from=build /app/packages/database/src ./packages/database/src
COPY --from=build /app/packages/data-schemas/src ./packages/data-schemas/src
COPY --from=prune /app/packages/database/scripts ./packages/database/scripts
COPY --from=prune /app/packages/database/drizzle ./packages/database/drizzle
COPY --from=build /app/applications/web/dist ./applications/web/dist
COPY --chmod=0444 docker/aws/certs/aws-rds-us-east-2.pem /app/certs/aws-rds-us-east-2.pem
COPY --chmod=0555 docker/aws/start.sh /usr/local/bin/keeper-start
ENV ENV=production NODE_ENV=production API_PORT=3001 PORT=3000 HOSTNAME=0.0.0.0 \
    VITE_API_URL=http://127.0.0.1:3001 COMMERCIAL_MODE=false KEEPER_SYNC_ENABLED=false
USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS -H 'Accept: text/html' http://127.0.0.1:3000/ >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/keeper-start"]

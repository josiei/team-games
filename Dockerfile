# Node 22 matches the repo's engines floor. better-sqlite3 13.0.3 ships
# Node-API prebuilds inside its npm tarball (including linux-x64/arm64 glibc),
# so no compiler toolchain is needed and the Node ABI version does not matter.
FROM node:22.23.3-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# corepack is not relied on; install the exact pnpm the lockfile was made with.
RUN npm install -g pnpm@10.34.7
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm -F @tg/web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app /app
# Drop dev dependencies. The server runs from source under tsx (@tg/shared is
# source-only), so tsx stays as a production dependency.
RUN pnpm install --frozen-lockfile --prod --filter @tg/server... && \
    mkdir -p /data
# /data is where fly.toml mounts the volume; DATABASE_URL must live inside it.
ENV DATABASE_URL=/data/team-games.sqlite PORT=8080
EXPOSE 8080
WORKDIR /app/packages/server
# Same as `pnpm start`, but exec'd directly so signals reach the process.
CMD ["./node_modules/.bin/tsx", "src/index.ts"]

# Lectern: one image holding the server and the built web app.
#
#   docker build -t lectern .
#   docker run -p 8787:8787 -v ./data:/data -e PUID=1000 -e PGID=1000 lectern

# ── Build stage: install everything, compile, then drop dev-only packages ──
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Build tools, in case better-sqlite3 has no prebuilt binary for this platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Install dependencies first, so code changes don't redo this slow step.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages packages
RUN npm run build && npm prune --omit=dev

# ── Runtime stage: just what's needed to run ──
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/package.json packages/server/
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/web/dist packages/web/dist

# Starts as root only to hand /data to PUID:PGID, then runs Lectern as that
# user (see docker/entrypoint.sh). setpriv comes with Debian.
COPY docker/entrypoint.sh /usr/local/bin/lectern-entrypoint
RUN chmod 755 /usr/local/bin/lectern-entrypoint && mkdir -p /data
ENV PUID=1000 \
    PGID=1000
VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["lectern-entrypoint"]
CMD ["node", "packages/server/dist/index.js"]

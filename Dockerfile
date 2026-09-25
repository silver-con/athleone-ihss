# Hearth production image.
#
#   docker build -t hearth .
#   docker run --env-file .env.production -p 3000:3000 hearth
#
# Uses Next.js "standalone" output (next.config.mjs), so the final image has
# only the server and the node_modules it actually uses. The migration and
# admin scripts (scripts/, db/, lib/) are copied in too, so the same image
# can run `node scripts/migrate.mjs` before starting — see
# docker-entrypoint.sh (RUN_MIGRATIONS=true) and deploy/DEPLOY-DIGITALOCEAN.md.

# ---- 1. dependencies ---------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- 2. build ----------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- 3. runtime --------------------------------------------------------
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as an unprivileged user, never root.
RUN groupadd --system --gid 1001 hearth && useradd --system --uid 1001 --gid hearth hearth

COPY --from=build --chown=hearth:hearth /app/.next/standalone ./
COPY --from=build --chown=hearth:hearth /app/.next/static ./.next/static
COPY --from=build --chown=hearth:hearth /app/public ./public
# Migration runner, seed and admin scripts, and what they import.
COPY --from=build --chown=hearth:hearth /app/scripts ./scripts
COPY --from=build --chown=hearth:hearth /app/db ./db
COPY --from=build --chown=hearth:hearth /app/lib ./lib
# The app bundles its own copies of these, but the seed / create-admin
# scripts import them directly. (pg is already in the standalone output.)
COPY --from=deps --chown=hearth:hearth /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --chown=hearth:hearth docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER hearth
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]

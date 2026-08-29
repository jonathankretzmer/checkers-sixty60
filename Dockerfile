# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the checkers-sixty60 MCP server (stdio JSON-RPC).
#
#   deps      : manifest + lockfile only — the cache anchor for every install
#   deps-prod : production-only node_modules for the runtime image
#   build     : full install (devDeps: tsc) + compile src/*.ts -> dist/*.js
#   runtime   : slim node image, production deps only, runs as non-root
#
# deps-prod and build both derive from deps and run in parallel under BuildKit.
# Editing src/ only reruns the compile — the two installs stay cached until
# package.json / bun.lockb change.
#
# All base-image versions are pinned below and overridable at build time:
#   docker build --build-arg NODE_VERSION=24.20.0 -t checkers-sixty60-mcp .
#
# NODE_VERSION tracks the package.json `engines.node` floor (>=24, Node 24 LTS
# "Krypton"). ALPINE_VERSION must be one the `node:<NODE_VERSION>` image
# actually publishes (a given Node patch only ships the Alpine minors current
# at its release — check https://hub.docker.com/_/node before bumping either).
# For fully reproducible builds, replace the tags with digests, e.g.
#   FROM oven/bun:1.3.14-alpine@sha256:<digest> AS deps

ARG BUN_VERSION=1.3.14
ARG NODE_VERSION=24.20.0
ARG ALPINE_VERSION=3.23

########################################
# deps — manifest + lockfile cache anchor
########################################
FROM oven/bun:${BUN_VERSION}-alpine AS deps

WORKDIR /app
COPY package.json bun.lockb ./

########################################
# deps-prod — production node_modules
########################################
FROM deps AS deps-prod

# --frozen-lockfile fails on lockfile drift; --production omits devDependencies.
RUN bun install --frozen-lockfile --production

########################################
# build — full install + tsc compile
########################################
FROM deps AS build

RUN bun install --frozen-lockfile

# `bun run build` == `tsc -p tsconfig.json` -> dist/
COPY tsconfig.json ./
COPY src/ ./src/
RUN bun run build

########################################
# runtime — slim node, stdio MCP
########################################
FROM node:${NODE_VERSION}-alpine${ALPINE_VERSION} AS runtime

ENV NODE_ENV=production \
    HOME=/home/node \
    SIXTY60_DATA_DIR=/data \
    SIXTY60_LOG_DIR=/logs \
    SIXTY60_HEALTHCHECK_PORT=8080

# The Checkers Sixty60 app API credentials (SIXTY60_API_KEY,
# SIXTY60_API_KEY_AUTH, SIXTY60_PROFILE_TOKEN) and any SIXTY60_STATE_KEY are
# NOT baked into the image. Pass them at run time only — `--env-file`,
# `-e`, compose `env_file:` / `environment:`, or a secrets mount. See
# `.env.example` and docker-compose.yml.

WORKDIR /app

# Health/readiness side channel (the MCP protocol itself is stdio). Reachable
# from outside the container only if this port is published (`docker run -p`).
EXPOSE 8080

# State and logs each get their own directory so they can be mounted as
# separate volumes. /data holds live session tokens and is kept 0700 (also
# re-enforced at write time in src/storage.ts); /logs holds mcp-server.log.
# Ownership is set before VOLUME so a fresh named volume inherits it.
RUN mkdir -p /data /logs \
  && chown -R node:node /data /logs /app \
  && chmod 700 /data
USER node

VOLUME ["/data", "/logs"]

COPY --from=deps-prod --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

# Probes the in-container health endpoint; no wget/curl dependency needed.
# --healthcheck targets SIXTY60_MCP_HTTP_PORT when set (--http mode), otherwise
# SIXTY60_HEALTHCHECK_PORT, so this one line works for both transports.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["node", "dist/mcp-server.js", "--healthcheck"]

# Default: MCP over stdio — the client must attach stdin (`docker run -i`).
# Multi-tenant Streamable HTTP host instead: append `--http` (see
# docker-compose.yml `mcp-http`). Self-starts via a require.main check.
ENTRYPOINT ["node", "dist/mcp-server.js"]

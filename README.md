# Checkers Sixty60 CLI (Bun + TypeScript)

This project provides a Bun CLI for:

- interactive auth (phone + OTP)
- local token persistence
- authenticated order fetch, cart, search, and basket operations
- an MCP server exposing the same capabilities over stdio (see [MCP server](#mcp-server))

## Run

```bash
bun install
bun run start
```

## Install

```bash
npm i -g checkers-sixty60
checkers-sixty60 --help
```

## Agent Skill

This repo includes a local skill for terminal-based AI agents:

- `skills/checkers-sixty60-cli/SKILL.md`

Use it when an agent needs structured guidance for auth, orders, product search, and basket operations through the `checkers-sixty60` CLI.

## Non-interactive usage

```bash
# Step 1: send OTP
bun run start request-otp --phone 0821234567

# Step 2: verify OTP and persist auth
bun run start verify-otp --phone 0821234567 --otp 1234

# Fetch orders (JSON output)
bun run start orders --json

# Fetch orders (compact output)
bun run start orders --compact

# View current cart (compact output)
bun run start view-cart --compact

# View current cart (full JSON)
bun run start view-cart

# Search products
bun run start search --query milk --compact

# Add product to basket (qty defaults to 1)
bun run start add-to-basket --product-id 5d3af63cf434cf8420737e3e --qty 1

# Remove product from basket (remove all by default)
bun run start remove-from-basket --product-id 5d3af63cf434cf8420737e3e
```

The CLI saves tokens to:

- `~/.checkers-sixty60/auth.json`

## Location

Store and cart context requests use latitude/longitude. By default the CLI uses generic Cape Town coordinates.

Persist location across sessions:

```bash
checkers-sixty60 set-location --lat -26.2041 --lng 28.0473
```

Override per session with env vars:

```bash
SIXTY60_LATITUDE=-26.2041 SIXTY60_LONGITUDE=28.0473 checkers-sixty60 view-cart
```

Saved settings are stored in `~/.checkers-sixty60/settings.json`.

Use your own nearby coordinates for best store availability and search/cart behavior.

## MCP server

The same login/orders/cart/search/basket capabilities are also exposed as an MCP server over stdio, so any MCP client (Claude Desktop, Claude Code, etc.) can drive the CLI's Checkers Sixty60 session directly.

```bash
checkers-sixty60 mcp
```

Tools exposed: `request_otp`, `verify_otp`, `list_orders`, `view_cart`, `search_products`, `add_to_basket`, `remove_from_basket`, `set_location`.

Auth works the same way as the CLI: `request_otp` then `verify_otp` persist the session to `~/.checkers-sixty60/auth.json`, and every other tool reuses that saved session automatically — no need to re-authenticate between calls (see [Local State](#local-state) below). `verify_otp` never returns the access/refresh token to the client, only a non-sensitive session summary.

Example Claude Desktop config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "checkers-sixty60": {
      "command": "npx",
      "args": ["-y", "checkers-sixty60", "mcp"]
    }
  }
}
```

### Multi-tenant Streamable HTTP hosting

`checkers-sixty60 mcp --http` (or `node dist/mcp-server.js --http`) starts a
Streamable HTTP server instead of stdio. It is meant to run behind an MCP
gateway (e.g. [Obot](https://obot.ai)) that terminates OAuth and forwards the
caller's identity; each caller gets an isolated Checkers Sixty60 session.

- Endpoints: `POST /mcp` (and `GET`/`DELETE`), `GET /health`, `GET /ready`.
- Stateless: no session is retained between requests, so the gateway can fan
  requests across replicas.
- Identity → tenant (`SIXTY60_AUTH_MODE`, fails closed if unset):

  | Mode | How the tenant id is derived | Required env |
  | --- | --- | --- |
  | `jwt` | validate a `Bearer` token, key on `sub` | `SIXTY60_OIDC_JWKS_URL`, `SIXTY60_OIDC_ISSUER`, optional `SIXTY60_OIDC_AUDIENCE` |
  | `proxy` | trust a gateway-injected header (private network only) | `SIXTY60_TRUST_PROXY_AUTH=1`, optional `SIXTY60_AUTH_HEADER` (default `x-forwarded-user`) |
  | `anonymous` | one shared `default` tenant (local dev) | `SIXTY60_ALLOW_ANONYMOUS=1` |

- Per-tenant state lives at `SIXTY60_DATA_DIR/tenants/<sha256(id)>/`; the CLI and
  stdio server keep using the flat files (they run as the `default` tenant).
- `SIXTY60_STATE_KEY` (base64 of 32 bytes) turns on AES-256-GCM envelope
  encryption of at-rest tenant state. Unset = plaintext JSON (CLI default).
- Each tenant still links their own Checkers account once via `request_otp` /
  `verify_otp` — the gateway's OAuth authenticates the *user*, not Checkers, and
  there is no refresh flow upstream.

```bash
docker compose up -d mcp-http   # see docker-compose.yml for the env matrix
```

## Docker

A multi-stage `Dockerfile` is included: bun compiles `src/` in a build stage, and the
runtime stage is a slim `node:*-alpine` image (production deps only, runs as non-root
`node`). All base-image versions are pinned via `ARG`s at the top of the `Dockerfile`
and can be overridden with `--build-arg`.

```bash
docker build -t checkers-sixty60-mcp .
```

### Paths and volumes

Everything the server persists lives under two directories so each can be a separate
volume. In the image they default to `/data` and `/logs`; anywhere else they default
to `~/.checkers-sixty60` and stderr-only.

| Env var | Image default | Contents | Mode |
|---|---|---|---|
| `SIXTY60_DATA_DIR` | `/data` | `auth.json`, `device.json`, `settings.json` | dir `0700`, files `0600` |
| `SIXTY60_LOG_DIR` | `/logs` | `mcp-server.log` (also echoed to stderr / `docker logs`) | dir `0755` |

`/data` and `/logs` are declared as `VOLUME`s, and the image `chown`s them to `node`
so a fresh named volume is writable without running as root. `/data` holds live
session tokens — keep it on a private volume, not a world-readable bind mount.

```bash
# One MCP session on stdio (-i keeps stdin open, --rm discards the container).
docker run -i --rm \
  -v checkers-sixty60-data:/data \
  -v checkers-sixty60-logs:/logs \
  checkers-sixty60-mcp

# Log in once; the token lands in the named volume and every later run reuses it.
# (drive it from your MCP client, or with a one-off JSON-RPC pipe)
```

MCP client config:

```json
{
  "mcpServers": {
    "checkers-sixty60": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "checkers-sixty60-data:/data",
        "-v", "checkers-sixty60-logs:/logs",
        "checkers-sixty60-mcp"
      ]
    }
  }
}
```

Bind mounts work too — `-v "$HOME/.checkers-sixty60:/data"` reuses an existing
host-side login. The container writes as uid `1000`; make sure that uid can write
the host path.

### docker compose

A reference [`docker-compose.yml`](docker-compose.yml) is included with the volumes,
env, published health port, and healthcheck wired up. It is a starting point, not a
turnkey service — the server only does something with a client on its stdin:

```bash
docker compose build

# Run one MCP session (‑T = no TTY, so stdin/stdout stay a clean JSON-RPC pipe).
docker compose run --rm -T mcp

# Or keep an idle container up just for the health endpoint:
docker compose up -d mcp
docker compose logs -f mcp
```

Point an MCP client at the compose service with an absolute path to the file:

```json
{
  "mcpServers": {
    "checkers-sixty60": {
      "command": "docker",
      "args": ["compose", "-f", "/abs/path/docker-compose.yml", "run", "--rm", "-T", "mcp"]
    }
  }
}
```

### Location

Store/cart/search calls need a latitude/longitude. In a container, either bake it
into the environment (`SIXTY60_LATITUDE` / `SIXTY60_LONGITUDE`, both shown commented
in the compose file) or call `set_location` once — it is saved to `settings.json` in
the data volume and reused thereafter.

### Health / readiness endpoint

The MCP protocol is stdio-only, so the image also starts a small HTTP status
endpoint for orchestrators. It is enabled by `SIXTY60_HEALTHCHECK_PORT` (set to
`8080` in the image; unset it to disable) and bound to `0.0.0.0` (override with
`SIXTY60_HEALTHCHECK_HOST`).

It reports the live MCP server state, not a static string:

| Route | 200 when | 503 when |
|---|---|---|
| `GET /health`, `/healthz`, `/` | process up, stdio transport not torn down | transport closed |
| `GET /ready`, `/readyz` | transport connected **and** tools registered | not yet connected / transport closed |

Every response body carries the full snapshot, e.g.:

```json
{
  "status": "ok",
  "ready": true,
  "server": "checkers-sixty60",
  "transport": "stdio",
  "pid": 1,
  "uptimeSeconds": 12,
  "mcp": { "connected": true, "tools": 8, "transportClosed": false, "errorCount": 0, "lastError": null }
}
```

`errorCount` / `lastError` are advisory — the MCP SDK keeps serving after a
malformed client frame, so they are surfaced for debugging but do not flip the
status on their own. A torn-down transport does.

The Dockerfile `HEALTHCHECK` runs `node dist/mcp-server.js --healthcheck`, which
probes `/ready` and exits non-zero on failure — no `curl`/`wget` needed in the
image. To reach it from the host, publish the port: `docker run -i -p 8080:8080 ...`.

## Local State

All under `SIXTY60_DATA_DIR` (default `~/.checkers-sixty60`, `/data` in the Docker image):

- Auth state (access/refresh tokens, phone, email, store IDs): `auth.json`
- Device id: `device.json`
- Location settings: `settings.json`

These files are written with owner-only permissions (`0600` on the files, `0700` on the directory) since they contain live session tokens, and are replaced atomically (write-temp-then-rename).

Under `mcp --http`, each tenant gets the same three files under `tenants/<sha256(identity)>/` instead; the CLI and stdio server always use the flat files above. Set `SIXTY60_STATE_KEY` (base64 of 32 bytes) to encrypt all of these at rest with AES-256-GCM.

Logs go to stderr by default; set `SIXTY60_LOG_DIR` to also append them to `<dir>/mcp-server.log`.

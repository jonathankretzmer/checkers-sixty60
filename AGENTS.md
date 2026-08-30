# Agent Notes (Repo)

This repo is a Node-compatible TypeScript CLI for interacting with Checkers Sixty60.

## Quick Start

```bash
bun install

# dev (runs TS directly)
bun run start -- --help

# build (emits dist/)
npm run build

# run built CLI
node dist/cli.js --help
```

## Core Commands

- Auth:
  - `checkers-sixty60 request-otp --phone <phone>`
  - `checkers-sixty60 verify-otp --phone <phone> --otp <code> [--reference <ref>]`
- Orders:
  - `checkers-sixty60 orders --compact`
  - `checkers-sixty60 orders --json`
- Cart:
  - `checkers-sixty60 view-cart`
  - `checkers-sixty60 add-to-basket --product-id <id> --qty <n> [--cart-id <id>]`
- Search:
  - `checkers-sixty60 search --query <text> --compact`
- Location / config:
  - `checkers-sixty60 addresses [--json]` (list delivery addresses saved on the Checkers account; read-only, marks the active one)
  - `checkers-sixty60 set-location --address-id <id>` (pin one of those) | `--last-used` (clear the pin, follow the most-recently-used)
  - `checkers-sixty60 config` (redacted state snapshot: phone, email, pinned-address id, device id, credential presence — no tokens)
- MCP server:
  - `checkers-sixty60 mcp` (stdio, single-user; tools mirror the commands above plus `remove_from_basket`, `list_addresses`, `set_location`, `get_config`)
  - `checkers-sixty60 mcp --http [--port <n>]` (Streamable HTTP, multi-tenant; for hosting behind an MCP gateway such as Obot)

## Local State

- Auth state: `~/.checkers-sixty60/auth.json`
- Device id: `~/.checkers-sixty60/device.json`
- Pinned delivery-address id: `~/.checkers-sixty60/settings.json` (`{ addressId, savedAt }`; absent = follow most-recently-used)

Under `mcp --http` the same three files are per-tenant at
`$SIXTY60_DATA_DIR/tenants/<sha256(identity)>/…`; the CLI and stdio server run
as the `default` tenant and keep using the flat paths above. `SIXTY60_STATE_KEY`
(base64, 32 bytes) enables AES-256-GCM envelope encryption of all of these.

## API Credentials

The Checkers app API keys are **not** in the source. Set them via env / `.env`
(see `.env.example`), only needed for the login/OTP flow:

- `SIXTY60_API_KEY` — `x-api-key` on `/users/verify`
- `SIXTY60_API_KEY_AUTH` — `x-api-key` on the OTP request/verify calls
- `SIXTY60_PROFILE_TOKEN` — bearer on the customer-profile call

`config.ts` reads them; `api.ts:required()` throws an actionable error if a
needed one is missing. `dist/*.js` entrypoints load `.env` from cwd via
`dotenv/config`.

## Location Handling

Many endpoints depend on latitude/longitude to resolve store contexts. Those
coordinates **only ever come from an address saved on the Checkers account** —
there is no local coordinate storage, no geocoding, and no default fallback.

- `api.ts:resolveDeliveryAddress(ctx)` is the single resolver. It reads the
  pinned address id (`tenant-state.readSelectedAddressId`, from `settings.json`),
  fetches the account's addresses, and returns the pinned one — or, if nothing
  is pinned, the one with the highest `lastUsedOn`. Throws an actionable error
  if the account has no address with coordinates.
- `fetchAddresses(ctx)` — `GET auth.sixty60.co.za/customers/<userId>/addresses`
  (the mongo profile id, ordinary user access token; `storeIds` may be `[]`, so
  it is safe to call mid-login/hydrate). Coordinates live at
  `coordinates.{latitude,longitude}`; `normalizeAddress` also tolerates
  `geoLocation.*` / top-level `lat`/`lng`.
- `checkers-sixty60 addresses [--json]` lists them (read-only; add/edit in the
  Sixty60 app) and marks the active one.
- `checkers-sixty60 set-location --address-id <id>` pins (writes
  `{ addressId, savedAt }` via `writeSelectedAddressId`); `--last-used` clears
  the file (`clearSelectedAddress`).
- `checkers-sixty60 config` shows `location.pinnedAddressId` (`null` = follow
  most-recently-used) and `location.active` — the resolved address in effect
  (one read-only lookup when a saved session exists; else `active: null` +
  `location.note`).

An account with zero saved addresses cannot resolve store context, so
delivery-dependent calls — and `login` / `requireAuth` hydration, which needs
store ids — fail until an address is added in the app.

## Code Map

- `src/cli.ts`: argument parsing and command routing
- `src/mcp-server.ts`: MCP tool definitions + stdio server (`createServer`, `runMcpServer`)
- `src/http-server.ts`: Streamable HTTP host for `mcp --http` (stateless, one tenant-bound context per request)
- `src/identity.ts`: request → tenant id (OIDC JWT / trusted proxy header / anonymous)
- `src/context.ts`: `AsyncLocalStorage` tenant context; `currentTenant()`, `runWithTenant()`
- `src/store.ts`: per-tenant `TenantStore` (`FileStore`), keyed lock chains, `default` tenant = legacy flat files
- `src/tenant-state.ts`: tenant-scoped device-id + pinned-delivery-address-id accessors used by `api.ts` / `session.ts`
- `src/crypto.ts`: optional AES-256-GCM envelope encryption for at-rest state (`SIXTY60_STATE_KEY`)
- `src/session.ts`: auth/session logic (login state, hydration, re-auth-on-expiry); reads the active tenant via `currentTenant()`
- `src/api.ts`: HTTP calls and request/response shaping; `fetchAddresses` / `resolveDeliveryAddress` supply delivery coordinates from the Checkers account
- `src/http.ts`: fetch wrapper (throws `HttpError` with status on non-2xx)
- `src/format.ts`: compact output shaping shared by CLI and MCP tools
- `src/storage.ts`: filesystem primitives (`readTextFile`, `writeTextFileAtomic`) + state types
- `src/config.ts`: file paths, env constants (incl. `SIXTY60_MCP_HTTP_PORT`, `SIXTY60_AUTH_MODE`, `SIXTY60_OIDC_*`)

## MCP Server Notes

- `tsconfig.json` uses `"module"`/`"moduleResolution": "Node16"` (not classic `"Node"`) because `@modelcontextprotocol/sdk`'s subpath exports (e.g. `@modelcontextprotocol/sdk/server/mcp.js`) are only resolved correctly by TypeScript when it honors the package's `exports` map. Don't revert this without re-verifying the MCP build.
- Auth session state is file-backed, so it persists across MCP tool calls and server restarts the same way it persists across separate CLI invocations — no extra caching logic needed.
- There is no refresh-token exchange implemented (Checkers issues one but this CLI never calls a refresh endpoint). An expired/invalid access token surfaces as a clear "re-authenticate" error from `withReauthHint` in `src/session.ts` rather than a raw HTTP failure.
- MCP tool outputs must never include `accessToken`/`refreshToken`/`bffToken`. `verify_otp` strips these before returning (see `toSessionSummary` in `src/mcp-server.ts`).
- Tenancy is transport-selected, not tool-selected: the tool handlers are identical for stdio and HTTP. stdio/CLI bind `defaultContext()` once at startup; `http-server.ts` wraps each request in `runWithTenant(makeContext(identity))`. Anything that touches per-user state must go through `currentTenant().store` (directly, or via `session.ts` / `tenant-state.ts`) — never re-add module-level file paths for auth/device/location.
- `store.lock(key, fn)` is **not reentrant**. `requireAuth` holds `"auth"`; `getOrCreateDeviceId` holds `"device"`. Don't nest the same key.
- The HTTP server fails closed: it refuses to start if no `SIXTY60_AUTH_MODE` (or inferring env) is set. `jose` is ESM-only and loaded via dynamic `import()` from `identity.ts`.

## Formatting / Linting

Use Biome:

```bash
bun run format
bun run lint
```

## Docs + Agent Skill Hygiene

When adding or changing CLI features, keep these docs in sync:

- `README.md`: user-facing installation and command usage
- `skills/checkers-sixty60-cli/SKILL.md`: agent-facing workflow guidance (commands, flags, and safety notes)

## Claude Code Plugin Distribution

`dist/` **is committed** (unlike a typical Node project) because this repo is also installed directly as a Claude Code plugin (`/plugin marketplace add ...` or `--plugin-dir`), which uses committed files as-is with no install/build step.

- `.mcp.json` declares the MCP server: `node ${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.js` (runs `src/mcp-server.ts` directly, bypassing `cli.ts`'s arg parsing — it self-starts via a `require.main === module` check).
- `dist/` must never go stale relative to `src/`. A versioned pre-commit hook rebuilds and re-stages it automatically whenever `src/` is part of a commit — enable it once per clone with:
  ```bash
  git config core.hooksPath .githooks
  ```
- If you commit through a tool that bypasses hooks, run `bun run build` manually first and include the `dist/` diff in the same commit.

## Publishing to npm

- `npm publish` runs `prepublishOnly` which calls `npm run build`, so the npm package always ships a fresh build regardless of what's committed.

Typical release:

```bash
npm version patch --no-git-tag-version
npm publish --access public --otp <OTP>
```

## Traffic Capture / Debugging

Use mitmproxy/mitmweb when endpoints drift.

```bash
mitmweb --listen-host 127.0.0.1 --listen-port 8080 -w checkers.flows
mitmdump -nr checkers.flows --set hardump=checkers.har
```

Add capture artifacts to local exclude (do not commit HAR/flows).

## Safety + Hygiene

- Never commit or paste personal data (phone numbers, addresses, precise lat/lng, tokens).
- Prefer placeholder examples in docs and help text.
- If secrets/PII accidentally land in git history, use `git filter-repo` to rewrite history and then force-push with lease.

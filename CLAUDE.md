# Project Notes for Claude

## Tooling

- Package manager and dev runner: **bun**, not npm/npx. In this dev environment `node`/`npx` are not on `PATH` (PowerShell or Bash tool), but `bun` is — use `bun x <tool>` in place of `npx <tool>` (e.g. `bun x tsc -p tsconfig.json --noEmit`, `bun x biome check .`).
- Lint/format: **Biome**, not eslint/prettier. `bun run lint` / `bun run format`.
- Type-check without emitting: `bun x tsc -p tsconfig.json --noEmit`.
- Build: `bun run build` (runs plain `tsc`, not a bun bundler step).
- The repo checks out with CRLF line endings (`core.autocrlf=true`). `bun x biome check .` will report formatting diffs on files you didn't touch — that's pre-existing and unrelated to CRLF-vs-LF noise, not a real lint failure. Only treat `bun x biome lint <files>` (not `check`, which includes the formatter) rule violations on files you actually changed as real.

## Runtime vs. dev-time bun usage

- `bun` is **dev/build tooling only**. The published/compiled CLI (`dist/cli.js`) is plain CommonJS targeting Node >=24 (`package.json` `engines`, Node 24 LTS) with a `#!/usr/bin/env node` shebang — it has no bun runtime dependency and runs fine under plain `node` or `npx checkers-sixty60`. CI smoke-tests `dist/mcp-server.js` under both `node` (24) and `bun`.
- Don't let that boundary blur: if a new entry point or launch config needs to run without bun installed (e.g. an MCP client config, a plugin manifest, a CI step), point it at the built `dist/` output run via `node`/`npx`, not `bun run src/....ts`.
- `dist/` is deliberately **committed** (see `.mcp.json` and the "Claude Code Plugin Distribution" section in AGENTS.md) because the Claude Code plugin runs `node ${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.js` directly with no build step. Run `git config core.hooksPath .githooks` once per clone so a pre-commit hook keeps `dist/` in sync whenever `src/` changes.

## MCP server

- `tsconfig.json` uses `"module"`/`"moduleResolution": "Node16"` (not classic `"Node"`) specifically so TypeScript resolves `@modelcontextprotocol/sdk`'s subpath exports (`@modelcontextprotocol/sdk/server/mcp.js`, `.../server/stdio.js`, `.../server/streamableHttp.js`) via its package.json `exports` map. Don't revert this without re-verifying `bun x tsc --noEmit` and a live stdio smoke test still pass.
- `zod` is a required (non-optional) peer dependency of the SDK — needed directly for tool `inputSchema` definitions, not just transitively.
- Auth/session state is file-backed, so it persists across MCP tool calls and process restarts the same way it persists across separate CLI invocations. No in-memory session caching needed or wanted.
- MCP tool outputs must never include `accessToken`/`refreshToken`/`bffToken`. `verify_otp` strips these via `toSessionSummary` before returning — keep that pattern for any new auth-adjacent tool.
- Two transports, one set of tool handlers: `checkers-sixty60 mcp` (stdio, single-user) and `checkers-sixty60 mcp --http` (Streamable HTTP, multi-tenant, for hosting behind a gateway like Obot). Tenancy is transport-selected — stdio/CLI bind `defaultContext()`; `http-server.ts` wraps each request in `runWithTenant(makeContext(identity))`. Per-user state is always reached via `currentTenant().store` (see `store.ts` / `context.ts`); never re-introduce module-level file paths for auth/device/location.
- `jose` (OIDC JWT verification in `identity.ts`) is ESM-only; this package is CJS, so it's loaded with dynamic `import("jose")`. Keep it dynamic.
- The HTTP host is stateless (new `McpServer` + transport per request) and fails closed if no `SIXTY60_AUTH_MODE` is configured. `serverInfo.version` in `createServer` is still hard-coded — bump it with `package.json` if you touch it.

## Security / sensitive data handling

- `{auth,device,settings}.json` hold live session tokens and must stay `0600` (dir `0700`) — enforced in `src/storage.ts:writeTextFileAtomic` (atomic write-temp-then-rename, chmod re-applied every write). Don't loosen this. In `--http` mode these are per-tenant under `$SIXTY60_DATA_DIR/tenants/<sha256(id)>/`.
- `SIXTY60_STATE_KEY` (base64, 32 bytes) turns on AES-256-GCM envelope encryption of at-rest state (`src/crypto.ts`). Plaintext files are still read back transparently, so enabling the key on an existing install is a no-op until each file is next written. Don't log or echo the key or decrypted contents.
- Never commit mitmproxy capture artifacts (`*.flows`, `*.har`) — they contain live tokens/OTPs in plaintext. Already gitignored; keep it that way if `.gitignore` is touched.
- **Never hardcode the Checkers app API credentials.** `SIXTY60_API_KEY`, `SIXTY60_API_KEY_AUTH`, `SIXTY60_PROFILE_TOKEN` are read from the environment (`config.ts` exports them; `api.ts:required()` throws a clear error when a needed one is missing). `.env` is gitignored; `.env.example` is the committed template. Old hardcoded values are in git history and deliberately not scrubbed — treat them as burned.
- `dist/cli.js` and `dist/mcp-server.js` load `.env` from cwd via `import "dotenv/config"` as their first import (before `./config` is evaluated). Keep it first.

## Code layout (see also AGENTS.md)

- Shared logic belongs in `src/session.ts` (auth/session) or `src/format.ts` (compact output shaping) so `cli.ts` and `mcp-server.ts` stay thin and never duplicate behavior — especially auth handling and anything touching tokens.
- Persistence goes through the tenant store: `src/store.ts` (`TenantStore`/`FileStore`), reached via `currentTenant()` from `src/context.ts`. `src/storage.ts` is now just filesystem primitives + types. `src/tenant-state.ts` holds the device-id / location accessors `api.ts` consumes. `store.lock(key, fn)` is not reentrant (`"auth"` vs `"device"`).

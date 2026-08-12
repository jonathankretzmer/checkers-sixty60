# Project Notes for Claude

## Tooling

- Package manager and dev runner: **bun**, not npm/npx. In this dev environment `node`/`npx` are not on `PATH` (PowerShell or Bash tool), but `bun` is — use `bun x <tool>` in place of `npx <tool>` (e.g. `bun x tsc -p tsconfig.json --noEmit`, `bun x biome check .`).
- Lint/format: **Biome**, not eslint/prettier. `bun run lint` / `bun run format`.
- Type-check without emitting: `bun x tsc -p tsconfig.json --noEmit`.
- Build: `bun run build` (runs plain `tsc`, not a bun bundler step).
- The repo checks out with CRLF line endings (`core.autocrlf=true`). `bun x biome check .` will report formatting diffs on files you didn't touch — that's pre-existing and unrelated to CRLF-vs-LF noise, not a real lint failure. Only treat `bun x biome lint <files>` (not `check`, which includes the formatter) rule violations on files you actually changed as real.

## Runtime vs. dev-time bun usage

- `bun` is **dev/build tooling only**. The published/compiled CLI (`dist/cli.js`) is plain CommonJS targeting Node >=18 with a `#!/usr/bin/env node` shebang — it has no bun runtime dependency and runs fine under plain `node` or `npx checkers-sixty60`.
- Don't let that boundary blur: if a new entry point or launch config needs to run without bun installed (e.g. an MCP client config, a plugin manifest, a CI step), point it at the built `dist/` output run via `node`/`npx`, not `bun run src/....ts`.
- `dist/` is deliberately **committed** (see `.mcp.json` and the "Claude Code Plugin Distribution" section in AGENTS.md) because the Claude Code plugin runs `node ${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.js` directly with no build step. Run `git config core.hooksPath .githooks` once per clone so a pre-commit hook keeps `dist/` in sync whenever `src/` changes.

## MCP server

- `tsconfig.json` uses `"module"`/`"moduleResolution": "Node16"` (not classic `"Node"`) specifically so TypeScript resolves `@modelcontextprotocol/sdk`'s subpath exports (`@modelcontextprotocol/sdk/server/mcp.js`, `.../server/stdio.js`) via its package.json `exports` map. Don't revert this without re-verifying `bun x tsc --noEmit` and a live stdio smoke test still pass.
- `zod` is a required (non-optional) peer dependency of the SDK — needed directly for tool `inputSchema` definitions, not just transitively.
- Auth/session state is file-backed (`~/.checkers-sixty60/auth.json`), so it persists across MCP tool calls and process restarts the same way it persists across separate CLI invocations. No in-memory session caching needed or wanted.
- MCP tool outputs must never include `accessToken`/`refreshToken`/`bffToken`. `verify_otp` strips these via `toSessionSummary` before returning — keep that pattern for any new auth-adjacent tool.

## Security / sensitive data handling

- `~/.checkers-sixty60/{auth,device,settings}.json` hold live session tokens and must stay `0600` (dir `0700`) — enforced in `src/storage.ts:writeJsonFile`. Don't loosen this.
- Never commit mitmproxy capture artifacts (`*.flows`, `*.har`) — they contain live tokens/OTPs in plaintext. Already gitignored; keep it that way if `.gitignore` is touched.
- Don't add hardcoded reverse-engineered API keys/tokens to files that aren't already the established home for them (`src/api.ts`) — avoid reintroducing duplicate copies elsewhere (this happened once, in `config.ts`, and was dead code).

## Code layout (see also AGENTS.md)

- Shared logic belongs in `src/session.ts` (auth/session) or `src/format.ts` (compact output shaping) so `cli.ts` and `mcp-server.ts` stay thin and never duplicate behavior — especially auth handling and anything touching tokens.

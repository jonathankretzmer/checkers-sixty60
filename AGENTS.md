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
- MCP server:
  - `checkers-sixty60 mcp` (stdio; tools mirror the commands above plus `remove_from_basket` and `set_location`)

## Local State

- Auth state: `~/.checkers-sixty60/auth.json`
- Device id: `~/.checkers-sixty60/device.json`
- Location settings: `~/.checkers-sixty60/settings.json`

## Location Handling

Many endpoints depend on latitude/longitude to resolve store contexts.

- Persist across sessions:
  - `checkers-sixty60 set-location --lat <value> --lng <value>`
- Override per session:
  - `SIXTY60_LATITUDE=<lat> SIXTY60_LONGITUDE=<lng> checkers-sixty60 view-cart`

Resolution order:
1. env vars
2. saved settings file
3. generic defaults

## Code Map

- `src/cli.ts`: argument parsing and command routing
- `src/mcp-server.ts`: MCP server (stdio) exposing the same operations as tools
- `src/session.ts`: shared auth-file session logic (login state, hydration, re-auth-on-expiry) used by both `cli.ts` and `mcp-server.ts`
- `src/api.ts`: HTTP calls and request/response shaping
- `src/http.ts`: fetch wrapper (throws `HttpError` with status on non-2xx)
- `src/format.ts`: compact output shaping shared by CLI and MCP tools
- `src/storage.ts`: local JSON persistence helpers (auth/device/location files, written `0600`/`0700`)
- `src/config.ts`: file paths and constants

## MCP Server Notes

- `tsconfig.json` uses `"module"`/`"moduleResolution": "Node16"` (not classic `"Node"`) because `@modelcontextprotocol/sdk`'s subpath exports (e.g. `@modelcontextprotocol/sdk/server/mcp.js`) are only resolved correctly by TypeScript when it honors the package's `exports` map. Don't revert this without re-verifying the MCP build.
- Auth session state is file-backed (`~/.checkers-sixty60/auth.json`), so it persists across MCP tool calls and server restarts the same way it persists across separate CLI invocations — no extra caching logic needed.
- There is no refresh-token exchange implemented (Checkers issues one but this CLI never calls a refresh endpoint). An expired/invalid access token surfaces as a clear "re-authenticate" error from `withReauthHint` in `src/session.ts` rather than a raw HTTP failure.
- MCP tool outputs must never include `accessToken`/`refreshToken`/`bffToken`. `verify_otp` strips these before returning (see `toSessionSummary` in `src/mcp-server.ts`).

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

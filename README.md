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

## Local State

- Auth state (access/refresh tokens, phone, email, store IDs): `~/.checkers-sixty60/auth.json`
- Device id: `~/.checkers-sixty60/device.json`
- Location settings: `~/.checkers-sixty60/settings.json`

These files are written with owner-only permissions (`0600` on the files, `0700` on the directory) since they contain live session tokens.

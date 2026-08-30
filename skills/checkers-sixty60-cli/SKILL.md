---
name: checkers-sixty60-cli
description: Drive a Checkers Sixty60 account — OTP auth, order history, cart, product search, basket edits, delivery-address selection, config — through the `checkers-sixty60` global CLI, `npx checkers-sixty60`, or the bundled MCP server. Trigger when the user wants to log into Checkers Sixty60, check their orders, view or edit their cart/basket, search the catalog, or choose their delivery address.
---

# Overview

The CLI, `npx`, and the MCP server are three different ways to interact with the same functionality.

| Usage | Reach for it when | Section |
| --- | --- | --- |
| MCP tools | an MCP client already has the `checkers-sixty60` server connected | [MCP usage](#mcp-usage) |
| Global CLI | `checkers-sixty60` is on `PATH`, or you will run several commands | [CLI usage](#cli-usage) |
| npx | one-off use or CI, without a global install | [npx usage](#npx-usage) |

Read **[Operations](#operations)** for what each action does and which fields it needs — that is identical across all three. Each usage section below only adds how to invoke it and the quirks specific to that front end.

# Operations

The typical flow: authenticate once → (optionally pick a delivery address) → search / view cart / edit basket / read orders. State persists, so step 1 is only needed again when the session expires.

## Authenticate (OTP)

Two calls, always in this order:

1. **Request OTP** — required: `phone` (SA format, e.g. `0821234567` or
   `+27821234567`). Sends the code by SMS and stores a pending reference.
2. **Verify OTP** — required: `phone`, `otp` (the SMS code). Optional:
   `reference` — supply only if the pending reference from step 1 was lost
   (e.g. a different process, or cleared state).

Notes:

- Verify automatically tries the number as `+27…`, then `27…`, then `0…`; you do not need to guess the format.
- A successful verify persists the session; every later operation reuses it with no re-authentication between calls.
- Login resolves store context from the account's delivery address, so the account must have **at least one saved address** (see below) or verify fails.

## Delivery address (location)

Delivery coordinates always come from an address already saved on the Checkers account. Addresses are managed in the Sixty60 app — this skill cannot add or edit them, and there are no latitude/longitude inputs.

With nothing pinned, delivery calls just follow the most-recently-used address — usually no action is needed here.

If the account has no saved address, set-location and any cart/search call errors until one is added in the app.

**List addresses**

No fields.
Read-only.
Shows each address's label, id, formatted address, and coordinates, most-recently-used first, and marks the one currently in effect.

**Set location**

Optional: `addressId` to pin a specific saved address.

Omit it (or use the "last-used" switch) to clear any pin and follow the account's most-recently-used address automatically.


## Show configuration

No fields.

Returns a redacted JSON snapshot — data dir, logged-in account (phone, email, store IDs), device id, and which API credentials are present.

Never contains tokens or OTP codes.

- `location.pinnedAddressId` — `null` means "follow most-recently-used".
- `location.active` — the delivery address actually in effect (label,
  `fullAddress`, coordinates, `selection: pinned | last-used`). It is `null`
  with a `location.note` when it cannot be resolved (not logged in, stale
  session, or no saved address).

## Orders

No fields.

Returns order history.

Prefer the **compact** form for quick structured summaries; use the full form only when you need the raw payload.

## View cart

No fields.

Returns the current cart(s). Call it **before and after** every basket edit to confirm line items and totals.

Prefer compact.

## Search products

Required:
- `query`

Optional:
- `page` (default `0`)
- `size` (default `20`)

Prefer compact output for product-selection steps.

## Add item to basket

Required:
- `productId`

Optional:
- `qty` (positive integer, default `1`)
- `cartId` (defaults to the 60-minute-delivery cart).

## Remove item from basket

Required:
- `productId`

Optional:
- `qty` (decrement by this much; omit to remove the line entirely)
- `cartId`

# MCP usage

Preferred when the server is connected — same session state, no argv or JSON string parsing. No availability check needed; the client lists the tools.

| Tool | Operation | Required | Optional |
| --- | --- | --- | --- |
| `request_otp` | Authenticate step 1 | `phone` | — |
| `verify_otp` | Authenticate step 2 | `phone`, `otp` | `reference` |
| `list_addresses` | List addresses | — | — |
| `set_location` | Set location | — | `addressId`, `useLastUsed` |
| `get_config` | Show configuration | — | — |
| `list_orders` | Orders | — | `compact` (default `true`) |
| `view_cart` | View cart | — | `compact` (default `true`) |
| `search_products` | Search products | `query` | `page` (`0`), `size` (`20`), `compact` (`true`) |
| `add_to_basket` | Add to basket | `productId` | `qty` (`1`), `cartId` |
| `remove_from_basket` | Remove from basket | `productId` | `qty`, `cartId` |

MCP-specific:

- `compact` defaults to **`true`** on the list/cart/search tools (the CLI default is the opposite). Pass `compact: false` for raw payloads.
- `set_location` with no arguments is valid — it clears the pin and follows the most-recently-used address.
- `verify_otp` returns only a non-sensitive session summary; it never returns access/refresh tokens.
- The server is started by an operator (`checkers-sixty60 mcp`, or `mcp --http` for multi-tenant hosting), not by the agent.

# CLI usage

Use when `checkers-sixty60` is installed on `PATH`.

Availability:

1. `checkers-sixty60 --help` — if it prints usage, you are ready.
2. Otherwise `npm i -g checkers-sixty60`, or use [npx](#npx-usage), or from a repo checkout `node dist/cli.js --help`.

| Command | Operation | Required | Optional |
| --- | --- | --- | --- |
| `request-otp` | Authenticate step 1 | `--phone <phone>` | — |
| `verify-otp` | Authenticate step 2 | `--phone <phone>`, `--otp <code>` | `--reference <ref>` |
| `login` | Interactive auth (both steps, prompts) | — | `--phone`, `--otp`, `--reference` |
| `addresses` | List addresses | — | `--json` |
| `set-location` | Set location | one of `--address-id <id>` or `--last-used` | — |
| `config` | Show configuration | — | — |
| `orders` | Orders | — | `--compact`, `--json` |
| `view-cart` | View cart | — | `--compact` |
| `search` | Search products | `--query <text>` | `--page <n>`, `--size <n>`, `--compact` |
| `add-to-basket` | Add to basket | `--product-id <id>` | `--qty <n>`, `--cart-id <id>` |
| `remove-from-basket` | Remove from basket | `--product-id <id>` | `--qty <n>`, `--cart-id <id>` |

CLI-specific:

- Output is JSON on stdout; errors go to stderr with a non-zero exit code.
- `--compact` is **off** by default — pass it to trim order/cart/search payloads.
- `set-location` requires exactly one of `--address-id` or `--last-used`; a bare `set-location` is an error (unlike the MCP tool).
- A `.env` in the working directory is loaded automatically (it holds the API
  credentials the OTP flow needs).

# npx usage

The same binary as the CLI with no global install — good for a one-off action
or a CI step.

- Prefix any [CLI command](#cli-usage) with `npx -y checkers-sixty60`
  e.g. `npx -y checkers-sixty60 verify-otp --phone <phone> --otp <code>`
  Flags, required fields, output, and `.env` behavior are identical to the CLI.
- The availability check is just running it; npx fetches the package on first use.
- Pin a version for reproducible CI: `npx -y checkers-sixty60@<version> …`.
- For an MCP client config, point the command at `npx -y checkers-sixty60 mcp`.

# Failure recovery (all usages)

1. Auth/context error → run request-OTP then verify-OTP again.
2. Validation error (missing or bad field) → fix that field, retry once.
3. Authorization failure after a previously working login → the session expired; re-authenticate. There is no refresh flow.
4. "No saved delivery address" → the account needs an address added in the Sixty60 app; nothing here can create one.

# Safety (all usages)

1. Never print OTP codes, access/refresh tokens, or raw auth-file contents.
2. Redact `Authorization`, token, and `device-id` values when sharing output.
3. Do not attempt to add or edit delivery addresses — that is the Sixty60 app's responsibility.

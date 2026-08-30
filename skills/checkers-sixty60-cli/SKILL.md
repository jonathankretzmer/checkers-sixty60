---
name: checkers-sixty60-cli
description: Use the Checkers Sixty60 CLI from terminal-based agent workflows. Trigger when the user asks to authenticate, request/verify OTP, fetch orders, view cart contents, search products, or add items to basket via the local `checkers-sixty60` command.
---

# MCP Alternative

If an MCP client already has the `checkers-sixty60` MCP server connected (`checkers-sixty60 mcp`), prefer calling its tools (`request_otp`, `verify_otp`, `list_orders`, `view_cart`, `search_products`, `add_to_basket`, `remove_from_basket`, `list_addresses`, `set_location`, `get_config`) directly instead of shelling out to the CLI below — same underlying session state, no argv/JSON parsing needed. The rest of this skill covers the terminal/CLI path.

# Verify CLI Availability

1. Run `checkers-sixty60 --help`.
2. If unavailable, run `npm i -g checkers-sixty60`.
3. If global install is not desired, run from repo with `node dist/cli.js --help`.

# Authenticate Non-Interactively

1. Request OTP: `checkers-sixty60 request-otp --phone <phone>`.
2. Verify OTP: `checkers-sixty60 verify-otp --phone <phone> --otp <code>`.
3. Use `--reference <ref>` only when the saved pending reference is missing.

Notes:

- Keep phone in SA format accepted by the CLI (for example `0821234567` or `+27821234567`).
- The CLI stores auth state in `~/.checkers-sixty60/auth.json`.
- Delivery coordinates always come from an address saved on the Checkers
  account — there are no lat/lng flags, no geocoding, and no env override.
  Login itself needs at least one saved address (it resolves store context).

# Delivery Address (location)

- List: `checkers-sixty60 addresses [--json]`
- Pin one: `checkers-sixty60 set-location --address-id <id>`
- Clear the pin (follow the account's most-recently-used): `checkers-sixty60 set-location --last-used`

Guidance:

- `addresses` is a read-only view of the account's delivery addresses, most-recently-used first; it marks the one currently in effect. Each row shows a label, the `[id]`, the formatted address, and its coordinates.
- With nothing pinned, every delivery call follows the account's most-recently-used address automatically — usually no `set-location` is needed.
- Adding or editing addresses is out of scope — direct the user to the Sixty60 app. If the account has none, `set-location` and cart/search calls error until one is added.
- Only the pinned `id` is stored locally (`~/.checkers-sixty60/settings.json`); coordinates are fetched live per call.

# Show Configuration

- `checkers-sixty60 config`

Prints a redacted JSON snapshot: data dir, logged-in account (phone, email, store IDs), device id, and which API credentials are present. Never emits tokens or credential values — safe to show the user.

`location` carries `pinnedAddressId` (`null` = follow most-recently-used) and `active` — the resolved delivery address in effect (label, `fullAddress`, coordinates, `selection: pinned | last-used`). With a saved session this makes one read-only address lookup; if it can't (not logged in, stale session, no saved address), `active` is `null` and `location.note` explains.

# Fetch Orders

Use one of:

- Compact: `checkers-sixty60 orders --compact`
- Full JSON: `checkers-sixty60 orders --json`

Prefer `--compact` when an agent needs structured summaries quickly.

# View Cart

Use one of:

- Compact: `checkers-sixty60 view-cart --compact`
- Full JSON: `checkers-sixty60 view-cart`

Prefer `--compact` when an agent needs structured summaries quickly. Use this before and after basket mutations to verify line items and totals.

# Search Products

Use:

- `checkers-sixty60 search --query <text> --compact`
- Optional paging: `--page <n> --size <n>`

Use compact output by default for product selection steps.

# Add Item to Basket

Use:

- `checkers-sixty60 add-to-basket --product-id <id> --qty <n>`
- Optional cart selection: `--cart-id <id>`

Guidance:

- Use quantity `1` when user did not specify quantity.
- Validate that `--qty` is a positive integer.

# Remove Item From Basket

Use:

- `checkers-sixty60 remove-from-basket --product-id <id>`

Optional:

- Decrement only: `--qty <n>`
- Pick cart: `--cart-id <id>`

# Failure Recovery

1. If auth context errors occur, rerun request+verify OTP flow.
2. If command fails with validation errors, fix flags and retry once.
3. If API returns authorization failures after login, re-authenticate.

# Safety

1. Never print OTP codes, access tokens, or auth file contents in full.
2. Redact sensitive header/token values when sharing command output.

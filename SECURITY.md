# Security Policy

## Supported versions

Only the latest published version (`npm`, `ghcr.io`, and `main`) receives fixes.

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

- Preferred: GitHub → this repo → **Security → Report a vulnerability** (private
  advisory).
- Alternative: email the maintainer listed in `package.json` / the GitHub
  profile.

Include: affected version/commit, reproduction steps, and impact. Expect an
initial response within a few days. There is no bounty program.

## Scope and non-issues

This is an **unofficial** client that talks to Checkers Sixty60's private mobile
API. Some things are known and not vulnerabilities in this project:

- **App API credentials are not bundled.** `SIXTY60_API_KEY`,
  `SIXTY60_API_KEY_AUTH`, and `SIXTY60_PROFILE_TOKEN` must be supplied by the
  operator via environment / `.env` (see `.env.example`). Earlier versions
  hard-coded these values; they were removed from the working tree but **remain
  in git history** and should be treated as burned — the upstream service can
  rotate them at any time.
- **Session tokens live on disk** under `~/.checkers-sixty60/` (or
  `SIXTY60_DATA_DIR`), files `0600` / dir `0700`. Set `SIXTY60_STATE_KEY` to
  encrypt them at rest (see README).
- The multi-tenant HTTP server (`mcp --http`) is designed to run **behind a
  gateway/reverse proxy** that terminates auth and rate-limits. Exposing it
  directly to the internet, or using `proxy` auth mode without network
  isolation, is an operator misconfiguration, not a project bug.

Reports of the above as "leaked secrets" or "unauthenticated endpoint" will be
closed with a pointer here.

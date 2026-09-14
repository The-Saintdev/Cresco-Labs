# Contributing to Cresco Labs

## Setup

1. Install Node.js 22 or newer and pnpm.
2. Run `pnpm install --frozen-lockfile`.
3. Copy `backend/.env.example` to `backend/.env` and use development-only values.
4. Start the API with `pnpm api` and the website with `pnpm dev`.

Run `pnpm check` before opening a change.

## Security rules

- Never commit provider keys, deployment secrets, signing certificates, local databases, uploads, or generated app bundles.
- Keep provider calls behind an authenticated backend adapter.
- Never return decrypted credentials, raw provider payloads, or provider-internal polling URLs to member clients.
- Store money in fixed-precision integer units.
- Preserve historical attribution when changing or archiving users and models.
- Add authorization and audit tests for every new administrative route.

## Product boundaries

Cresco has a member website, a team mobile app, and a separate admin mobile app. There is intentionally no admin website and no public registration flow.

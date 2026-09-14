# Cresco API

The shared API is the security and accounting boundary for the member website, team mobile app, and admin mobile app. Clients never receive provider credentials or call model providers directly.

## One backend, two runtimes

`src/worker.js` is the hosted Cloudflare API. It stores records in D1, private reference files in R2, and provider work in Cloudflare Queues. `src/server.js` is the local preview adapter and keeps throwaway data under `.data`.

The route contract is identical, so the Vercel website, team app, and admin app all use one deployed Worker URL.

## Hosted data ownership

- D1 stores team accounts, model catalog records, encrypted provider credentials, generation history, prompts, options, costs, balances, budgets, upload metadata, and audit events.
- R2 stores the private image, video, and audio references attached to requests.
- Queues stores only short-lived generation job messages; durable job state remains in D1.
- Worker Secrets stores the root encryption, token-signing, password-pepper, bootstrap, and asset-signing secrets.

Provider credentials are encrypted before insertion into D1 and are never returned by any API response.

## Local preview

Copy `.env.example` to `.env`, replace the local secrets, then run `pnpm api` from the repository root. Local records use `.data/cresco.json`; reference uploads use `.data/uploads`. Both paths are ignored by Git.

To run the Cloudflare implementation locally, copy `.dev.vars.example` to `.dev.vars`, apply the local D1 migration, and start Wrangler:

```bash
pnpm --dir backend cf:d1:local
pnpm api:cloudflare
```

## Free Cloudflare deployment

The production bindings are declared in `wrangler.jsonc`. Create one D1 database, one private R2 bucket, the generation queue and its dead-letter queue, replace the D1 database ID and public URLs in the config, apply migrations, add the four required secrets plus the recommended asset-signing secret, and deploy. The exact order is documented in `../docs/deployment-cloudflare.md`.

## Member routes

- `POST /v1/auth/login` — login-only authentication
- `GET /v1/me` and `PATCH /v1/me` — current profile, preferences, and password changes
- `GET /v1/models` — non-archived catalog with computed execution readiness
- `GET /v1/history` — role-scoped, cursor-paginated generation history
- `GET /v1/generations/:id` — one role-scoped generation
- `POST /v1/generations` — budget-checked generation submission
- `GET /v1/usage/summary` — team spend, committed spend, model/member totals, balances, and policy
- `POST /v1/uploads` — authenticated image, video, or audio reference upload up to 25 MB

## Administrator routes

- `GET` and `POST /v1/admin/users`
- `PATCH /v1/admin/users/:id`
- `GET` and `POST /v1/admin/models`
- `PATCH` and `DELETE /v1/admin/models/:id` — delete archives the model and preserves historical attribution
- `GET /v1/admin/providers`
- `POST /v1/admin/providers/credentials`
- `PATCH /v1/admin/policies`
- `GET /v1/admin/audit`
- `GET /v1/admin/balances`
- `POST /v1/admin/reconcile`

## Readiness and accounting

A model is executable only when it is published, has an endpoint, has an encrypted provider credential, and has a supported server adapter. Direct API submissions to unready models are rejected.

The backend checks the configured per-generation and monthly workspace limits before dispatch. Queued requests reserve their catalog estimate; completed requests use their recorded cost. A zero limit means no hard cap.

The local JSON and upload adapters are development-only. The free hosted schema is in `db/d1`; the optional PostgreSQL contract in `db/001_initial.sql` is retained only for a future migration.

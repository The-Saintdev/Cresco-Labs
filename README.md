# Cresco Labs

Cresco Labs is a private AI workhub for an approved team. It provides friendly interfaces for text, image, and video models while keeping provider details and credentials out of member-facing clients.

## Frontend clients

- **Member website** — React + Vite in `frontend`
- **Team mobile app** — Expo/React Native in `team-app`
- **Admin mobile app** — Expo/React Native in `admin-app`
- **Shared backend** — local Node preview and Cloudflare deployment in `backend`

There is intentionally no admin website. User approval, model configuration, provider credentials, costs, and audit controls belong only in the admin mobile app.

## Repository layout

```text
backend/        One central API, D1 schema, R2 uploads and provider queue
frontend/       Member web app and Vercel configuration
admin-app/      Private Expo admin app and EAS profiles
team-app/       Member Expo app and EAS profiles
mobile-shared/  Shared mobile API client and design tokens only
docs/           Architecture, accounting and deployment instructions
```

## Access model

All clients are login-only. Members cannot register themselves. The workspace administrator creates and approves every account from the admin mobile app.

## Brand system

The interface uses an iOS-inspired liquid-glass language with translucent surfaces, restrained blur, soft highlights, and a consistent palette:

- Ink `#101313`
- Mist `#EEF2ED`
- Sage `#B9D78E`
- Coral `#E99A7A`
- Lilac `#B7A7D5`
- Blue `#7DA8BD`
- Sand `#DDBA69`

The primary web logo is stored at `frontend/public/brand/cresco-mark.png`. Mobile app icon copies live in each app's `assets` directory.

## Development

```bash
pnpm install
pnpm api
pnpm dev
```

Run the mobile apps separately:

```bash
pnpm team:mobile
pnpm admin:mobile
```

Create a production web build:

```bash
pnpm build
```

Run the complete local validation suite with `pnpm check`. Use the [`complete launch guide`](docs/launch-guide.md) for the end-to-end release order; the [`credentials checklist`](docs/credentials-checklist.md) and [`Cloudflare reference`](docs/deployment-cloudflare.md) provide supporting detail.

## Security boundary

Provider API keys must never be added to the website or mobile bundles. The admin app sends credentials to the shared backend over an authenticated connection; the backend encrypts them with AES-256-GCM and never returns them to a client. Set a separate `CRESCO_ENCRYPTION_KEY` in the API environment before entering provider credentials. Real secrets belong in local environment variables or a deployment secret manager and are excluded by `.gitignore`.

The one shared API lives in `backend`. Copy its `.env.example` to `.env`, replace every development secret, and run it before starting a client. The Node entry point is for local preview; Cloudflare Workers, D1, R2, and Queues provide free-first hosted persistence. Environment files and local API data are ignored by Git.

Reference image, video, and audio files are uploaded through the authenticated API, linked to their generation records, and stored under the ignored local data directory during development. Mobile sessions use Expo SecureStore. Password changes and admin resets invalidate earlier sessions.

Administrators can enforce a monthly workspace budget and a maximum cost per generation. The API reserves estimated cost for queued work and rejects requests that exceed a hard limit. Removing a model archives it so historical requests and spend remain intact.

## Provider accounting

Every provider integration implements Cresco's shared request, usage, cost, and balance contract. The backend remains the source of truth for member attribution and prompt audit logs. fal.ai requests are reconciled against its documented billing-event API when the stored key has `ADMIN` scope. BytePlus ModelArk requests run directly through its regional API and remain internally estimated until separate billing-report credentials are configured. See [`docs/provider-accounting.md`](docs/provider-accounting.md).

The production persistence and scaling contract is documented in [`docs/production-architecture.md`](docs/production-architecture.md). Cloudflare D1 migrations live in [`backend/db/d1`](backend/db/d1), and the optional PostgreSQL schema remains in [`backend/db/001_initial.sql`](backend/db/001_initial.sql).
"# Cresco-Labs" 

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

npm workspaces monorepo plus a sibling Go service:

- `client/` — React 19 + Vite + Tailwind v4 SPA (admin panel UI).
- `server/` — Express 5 + TypeScript API. Auth via Lucia, data via `pg` (Supabase Postgres). Also exposes a Vercel serverless entry at `server/api/[...all].ts` that re-exports the Express app.
- `rp-bot-go/` — Standalone Go Discord bot (`discordgo`, `pgx`, `go-redis`, Prometheus, Sentry). Not part of the npm workspace.
- `server/sql/` — Schema files. `site.sql` / `001_bots_schema.sql` define the control-plane (`site` schema). `bot_schema_template.sql` is instantiated per-bot (one Postgres schema per bot, see `bot-store-postgres.ts`).

## Common commands

Run from repo root unless noted:

- `npm run dev` — Runs server (`tsx watch`, port 4010) and client (Vite, port 5173) in parallel. Client proxies `/api` → `http://localhost:4010`.
- `npm run build` — Builds server (`tsc`) then client (`tsc -b && vite build`).
- `npm run lint` — Lints both workspaces.
- `npm run start` — Runs built server (`node dist/index.js`).
- `npm run test:server` — Jest (ts-jest), runs `server/tests/*.test.ts` serially. Single test: `npm test -w server -- tests/panel_ssrf.test.ts` (or `-t "<name>"`).
- Go bot: `cd rp-bot-go && go run ./cmd/bot` (or `go build ./cmd/bot`). No tests checked in.

## Server architecture

`server/src/app.ts` is the composition root — it wires env, the Postgres bot service, the admin user store, and Lucia, then mounts routers. `server/src/index.ts` only binds the HTTP listener; `server/api/[...all].ts` re-exports `app` for Vercel. Don't add side effects at module top-level if they shouldn't run in serverless cold starts.

Routing convention: admin routes are mounted under both `/api/admin` and `/admin` (the Vercel rewrite strips `/api`). The admin-protected sub-router chains, in order, `requireAdminSession` → `requireAdminPrincipal` → `requireCsrfToken` before mounting `/bots`. Any new admin-only endpoints must go through this chain.

Auth: Lucia sessions are backed by Postgres (`admin-user-store-postgres.ts`). CSRF is enforced via `X-CSRF-Token` header (see `middleware/csrf.ts` and the CORS allowlist in `app.ts`). Helmet CSP is only enabled in production.

Per-bot schemas: each bot owns a dedicated Postgres schema, created from `sql/bot_schema_template.sql`. `bot-service.ts` / `bot-store-postgres.ts` encapsulate provisioning and CRUD — go through them rather than issuing ad-hoc SQL against bot-specific schemas. The `site` schema holds control-plane tables (admins, sessions, bot registry).

Discord interactions: `utils/discord-api.ts` is the only place that calls the Discord REST API. There is an existing SSRF test (`tests/panel_ssrf.test.ts`) — preserve URL/host validation when modifying it.

## Client architecture

Vite + React 19 with React Query for server state and React Hook Form + Zod for forms. Source layout: `views/` (route-level pages), `components/`, `contexts/`, `api/`. Styles use Tailwind v4 via `@tailwindcss/vite` plus a top-level `style.less` / `style.css`. Lucide icons. The client talks only to `/api/*` — in dev via Vite proxy, in prod via the Vercel rewrite to the deployed server.

## Go bot architecture

`cmd/bot/` is the binary entrypoint; `main.go` at the repo root of `rp-bot-go` is the actual main (loads `.env`, wires config/db/redis/Prometheus, starts the Discord session). `internal/` is split into `bot` (gateway/heartbeat), `handlers` (slash-command/component handlers: actions, admin, allowlist, tickets, verification), `services` (presence, ratelimit), `config`, and `db` (pgx pool). The bot reads the same Postgres database as the server but operates on the per-bot schemas provisioned by the server.

## Conventions

- TypeScript everywhere on the JS side; server is CommonJS (`"type": "commonjs"`), client is ESM.
- Env config is centralized in `server/src/config/env.ts` — add new env vars there, not via direct `process.env` reads in modules.
- Tests live in `server/tests/` only; `roots` is set so tests elsewhere are ignored.

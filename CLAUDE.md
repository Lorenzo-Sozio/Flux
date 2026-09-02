# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start development server (localhost:3000)
npm run build        # Production build
npm run check        # Biome lint + format check (run before committing)
npm run check:fix    # Biome lint + format auto-fix
npm run lint         # Biome lint only
npm run format       # Biome format only
```

There are tests, and only where a bug is expensive.

```bash
npm test             # vitest, runs in under a second
npm run test:mutations   # do the tests know how to fail?
```

They cover the **boundary surface** and nothing else: who a machine-to-machine caller
is, which tenant it may write into, and what the import API accepts. Everywhere else a
bug costs a wrong screen; here it costs one customer's data written into another
customer's database, and it does not look like a failure — it looks like a 201.

`npm run test:mutations` breaks one line at a time and requires the suite to go red for
each break. A green suite proves the code passes the tests; it does not prove the tests
would notice if the code were wrong. Adding a test to this surface means adding a
mutation for it in `scripts/mutations/` — it has already found one dead branch.

Tests marked `it.fails` are **known gaps**, not failures: they pass while the behaviour
is still broken and start failing the day someone fixes it, which is exactly when the
note is worth reading.

### Scheduled work

Cron endpoints live under `src/app/api/cron/` and are authorised with
`Authorization: Bearer $CRON_SECRET`. On Vercel they are declared in `vercel.json`, and
Vercel sends that header itself as long as the `CRON_SECRET` environment variable is set —
so **setting it is not optional**: `verifyCronRequest` fails closed, and an unset secret
means every job returns 500 forever.

⚠️ **The schedules in `vercel.json` need the Pro plan.** On Hobby, Vercel allows two cron
jobs and runs them once a day at an hour of its choosing, which turns `email-worker` from a
queue into a daily batch. Anywhere else, call the same URLs from any scheduler with the
Bearer header — they are plain GET endpoints.

⚠️ A route nobody calls is a job that silently does not run: nothing logs the absence.

```
webhook-retry        every 5 minutes   redelivers failed webhook events
email-worker         every minute      sends queued emails
campaign-scheduler   every 5 minutes   starts due campaigns
task-reminders       every 15 minutes  reminds about tasks
ticket-sla-check     every 15 minutes  flags tickets past their SLA
task-overdue-check   daily at 06:00    flags overdue tasks
ticket-autoclose     daily at 03:00    closes resolved tickets
```

⚠️ `webhook-retry` is what makes outgoing events at-least-once instead of
at-most-once. Without it a lost event is lost, and whoever was waiting for it has no
way of knowing.

### Database (Drizzle ORM + Neon Postgres)

```bash
# Generate a new migration after schema changes
npx drizzle-kit generate

# Push schema directly to DB (dev only)
npx drizzle-kit push

# Open Drizzle Studio
npx drizzle-kit studio
```

Migrations live in [src/db/migrations/](src/db/migrations/). Schema is defined in [src/db/schema.ts](src/db/schema.ts).

## Architecture

### Project Identity

This is **Flux CRM** — a full-featured CRM platform (not just a template). It's built on Next.js 16 App Router with TypeScript, Tailwind CSS v4, shadcn/ui, Drizzle ORM, and NextAuth v5.

### Colocation-based file structure

Each dashboard feature lives entirely inside its route folder. Shared UI, hooks, and config live at the top level.

```
src/
  actions/          # All Server Actions ("use server"), one file per domain
  app/
    (main)/dashboard/   # All CRM routes (colocated page + _components)
    (external)/         # Auth pages (login, register, etc.)
    api/                # Route handlers
  components/
    crm/            # Shared CRM-specific components and automation engine
    ui/             # shadcn/ui primitives
    dashboard/      # Shared dashboard chrome (sidebar, header)
    notifications/  # Notification components
  config/           # APP_CONFIG (name, version, meta)
  db/               # Drizzle schema, migrations, db client
  hooks/            # Shared React hooks
  lib/              # Utilities (auth-guard, etc.)
  navigation/       # Sidebar nav item definitions
  server/           # Server-only helpers (cookie utilities)
  stores/           # Zustand stores
  styles/           # Global CSS
```

### Data flow: Server Actions

All mutations go through Server Actions in [src/actions/](src/actions/). They follow a consistent pattern:
1. Call `requireWriteAccess()` or `requireAdminAccess()` from [src/lib/auth-guard.ts](src/lib/auth-guard.ts) at the top
2. Perform the DB operation via Drizzle
3. Call `revalidatePath(...)` to invalidate Next.js cache
4. Fire webhooks via `dispatchWebhook(...)` (fire-and-forget)
5. Run automation rules via `after(() => runAutomations(...))` (zero-latency, post-response)

### Authentication & RBAC

- **NextAuth v5** with Drizzle adapter ([src/auth.ts](src/auth.ts))
- Providers: Google OAuth + Credentials (email/password with bcrypt)
- Four roles: `owner` > `admin` > `editor` > `viewer`
- Route protection in middleware ([src/middleware.ts](src/middleware.ts)): `/dashboard/users`, `/dashboard/roles`, `/dashboard/settings` require admin/owner
- Server Action protection via `requireWriteAccess()` (blocks `viewer`) and `requireAdminAccess()` (requires `admin`/`owner`)
- `viewer` role is **read-only** everywhere — always guard mutations

### Automation Engine

- Rules defined in DB (`automationRules` table), evaluated at runtime
- Engine lives in [src/components/crm/automation/rule-engine.ts](src/components/crm/automation/rule-engine.ts)
- Triggered via `runAutomations({ entityType, entityId, event, oldData, newData })` inside `after()` callbacks in Server Actions
- Events: `onCreate`, `onUpdate` on entities like `deal`, `contact`, etc.

### Key domain modules

| Module | Route | Actions file |
|---|---|---|
| Pipeline / Deals | `/dashboard/pipeline` | [src/actions/pipeline.ts](src/actions/pipeline.ts) |
| Contacts | `/dashboard/contacts` | [src/actions/crm.ts](src/actions/crm.ts) |
| Companies | `/dashboard/companies` | [src/actions/crm.ts](src/actions/crm.ts) |
| Quotes | `/dashboard/quotes` | [src/actions/quotes.ts](src/actions/quotes.ts) |
| Support Tickets | `/dashboard/support/tickets` | [src/actions/support.ts](src/actions/support.ts) |
| Automation Rules | `/dashboard/automation` | [src/actions/automation.ts](src/actions/automation.ts) |
| Marketing | `/dashboard/marketing` | [src/actions/marketing.ts](src/actions/marketing.ts) |

### Sidebar navigation

Defined in [src/navigation/sidebar/sidebar-items.ts](src/navigation/sidebar/sidebar-items.ts) as typed `NavGroup[]`. Add new routes here to make them appear in the sidebar.

### Environment variables required

- `DATABASE_URL` — Neon Postgres connection string
- `AUTH_SECRET` — NextAuth secret
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` — Google OAuth
- `RESEND_API_KEY` — Email sending via Resend

### Tooling notes

- **Biome** (not ESLint/Prettier) handles all linting and formatting. Config in [biome.json](biome.json).
- **Husky + lint-staged** runs `biome check --write` on staged files pre-commit.
- **shadcn/ui** components are added via `npx shadcn add <component>`. Config in [components.json](components.json).
- Path alias `@/` maps to `src/`.

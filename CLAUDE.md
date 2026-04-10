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

There are no automated tests in this project.

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

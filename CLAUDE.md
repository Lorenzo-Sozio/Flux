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

**A cron route is one function, run once per workspace.** Write it as a body and hand
it to `runCronJob`, which authenticates the request, iterates the tenant registry and
sets the active workspace around each call — so anything it invokes, including server
actions written for the dashboard, resolves `getDb()` to the right database:

```ts
export async function GET(req: Request) {
  return runCronJob("ticket-autoclose", req, async (db, tenant) => ({ closed: await closeThem(db) }));
}
```

⚠️ **Never call `getDb()` from a cron route, a webhook, or any public page.** It reads
the `x-tenant-id` header the proxy injects only for authenticated dashboard requests,
and throws when it is absent. Every one of these entry points used to call it anyway:
all seven jobs, the public quote page, click and open tracking, unsubscribe, RSVP and
the Resend delivery callback. None of them worked, and none of them said so.

Outside the dashboard the tenant comes from the data, not from the request:
`forEachTenant` / `runCronJob` for scheduled work, and `resolveTenantByProbe` for an
opaque token (see [src/lib/tenant-resolve.ts](src/lib/tenant-resolve.ts)).

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

### Deploy: Vercel e Cloudflare Workers

The app deploys to either. Vercel is configured by [vercel.json](vercel.json); Cloudflare
by [wrangler.jsonc](wrangler.jsonc) + [open-next.config.ts](open-next.config.ts), through
the OpenNext adapter.

```bash
npm run cf:build     # next build + bundle the Worker into .open-next/
npm run cf:preview   # build, then run it locally on workerd
npm run cf:deploy    # build + wrangler deploy
npm run cf:typegen   # regenerate cloudflare-env.d.ts from the bindings
```

**Cloudflare Workers Builds** (deploy from the dashboard) must be configured as:

| | |
|---|---|
| Build command | `npx opennextjs-cloudflare build` |
| Deploy command | `npx wrangler deploy --keep-vars` |

⚠️⚠️ **`--keep-vars` is not optional.** Without it `wrangler deploy` treats
wrangler.jsonc as the complete list of the Worker's variables and **deletes every
secret that is not in it** — `DATABASE_URL`, `AUTH_SECRET`, `PLATFORM_ENCRYPTION_KEY`,
`CRON_SECRET`, `RESEND_API_KEY` and the rest, all of which are set with
`wrangler secret put` and therefore appear nowhere in the config file.

Nothing fails at deploy time. The next request is what fails: without
`PLATFORM_ENCRYPTION_KEY` no tenant database can be decrypted, so the Worker answers
every page with an error, and the deploy that caused it looks like it succeeded. The
`cf:deploy` and `cf:upload` scripts already pass the flag; the dashboard uses whatever
is typed in that box, so it has to be typed there too.

⚠️ `NEXT_PUBLIC_*` variables are inlined by Next at **build** time, so the `vars` block
in wrangler.jsonc reaches the runtime but not the build. `NEXT_PUBLIC_APP_URL` and
`NEXT_PUBLIC_ROOT_DOMAIN` must also exist as **build** environment variables in the
Workers Builds settings, or the client bundle is compiled with them empty.

⚠️ Leaving the build command at the auto-detected `npm run build` produces `.next/`
but not `.open-next/`, and the deploy fails with:

```
ERROR Could not find compiled Open Next config, did you run the build command?
```

The message is confusing because it comes from a command nobody typed. Since
[open-next.config.ts](open-next.config.ts) exists, `wrangler deploy` detects an OpenNext
project and silently re-dispatches to `opennextjs-cloudflare deploy`, which needs
`.open-next/.build/open-next.config.edge.mjs` — an artifact only `opennextjs-cloudflare
build` produces. Detection needs all three of `next.config.*`, `open-next.config.*`, and
an installed `@opennextjs/cloudflare`; it is skipped for `--dry-run`, `--config`, and
`--no-autoconfig`, which is why `wrangler deploy --dry-run` validates fine while the real
deploy does not.

If the dashboard build command cannot be changed, setting the **deploy** command to
`npm run cf:deploy` also works — it builds and deploys in one step.

⚠️ **The Worker name lives in three places and they must agree**: `name` in
wrangler.jsonc, the `service` of the `WORKER_SELF_REFERENCE` binding, and the Worker
on the Cloudflare account. It is *not* derived from `package.json` — that name is
`studio-admin`, the Worker is `flux`, and letting Cloudflare auto-detect the config
produces exactly one error:

```
Service binding 'WORKER_SELF_REFERENCE' references Worker 'studio-admin' which was not found.
```

⚠️ Cron jobs are **not** portable between the two. Vercel schedules HTTP requests; on
Cloudflare a trigger invokes the `scheduled` export, which OpenNext's generated worker
does not have. [custom-worker.ts](custom-worker.ts) adds it and re-issues each job as a
real request with the `Authorization: Bearer $CRON_SECRET` header, so the routes under
`src/app/api/cron/` stay unchanged. **The schedule strings in custom-worker.ts must match
`triggers.crons` in wrangler.jsonc exactly** — Cloudflare passes the cron as a string,
and a mismatch is a silent no-op.

⚠️ The Free plan allows 5 cron triggers per account. The seven jobs are grouped into five
schedules to fit; an eighth job on a new schedule needs Workers Paid.

⚠️ The bundle is ~8 MB gzipped. That fits Workers Paid (10 MB) but **not** Free (3 MB).

What does **not** work on Workers, because there is no filesystem and no long-lived
process:

- `src/instrumentation.ts` skips the node-cron scheduler there (it detects
  `navigator.userAgent === "Cloudflare-Workers"`); scheduled automation rules do not run.
- ~~`src/actions/tenants.ts` and `src/app/api/admin/migrate-all/route.ts` read tenant
  migration SQL from `process.cwd()`.~~ Fixed: migrations are embedded in the build,
  see below.
- ~~`src/app/api/documents/[id]/route.ts` reads uploads from disk.~~ Fixed: uploads go
  to object storage, see below.

### Document storage

[src/lib/storage.ts](src/lib/storage.ts) picks a store from what the environment
provides, rather than from a flag that can disagree with reality:

1. an R2 bucket bound as `DOCUMENTS` — production on Workers, declared in wrangler.jsonc;
2. any S3-compatible endpoint, when `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` /
   `S3_SECRET_ACCESS_KEY` are set — Vercel, or self-hosting;
3. the local disk, development only. On Workers there is no disk, so rather than
   fall back to one that cannot work, `getStorage()` throws and says what to set.

⚠️⚠️ **A binding for a resource the account does not have breaks every deploy.** The
`r2_buckets` block in wrangler.jsonc is currently **commented out**, because R2 was not
enabled on the account and wrangler checks bindings against the account at deploy time.
Declaring `flux-documents` there took production down on 4 September 2026 — the same
mechanism as the `WORKER_SELF_REFERENCE` error below, and just as quiet: the failure is
in the deploy step of a job whose build succeeded.

To turn document storage on, in this order:

1. enable R2 in the Cloudflare dashboard (once, for the account);
2. `npx wrangler r2 bucket create flux-documents`;
3. uncomment the `r2_buckets` block in wrangler.jsonc and deploy.

Until then uploads fail with a message naming what to configure, and everything else
works. The alternative to R2 is any S3-compatible store, set as Worker secrets.

⚠️ The storage key carries **nothing** from the uploaded filename except an extension
matched against a strict pattern, and the read path re-checks the key's shape before
using it — a filename is attacker-controlled and has no business reaching a path.
`src/lib/storage.test.ts` holds that line.

Documents uploaded before this change hold a relative disk path in `document.url`
instead of a key. They are still read through the local driver, which is the only
place those bytes could be; on a deployed server they are almost certainly gone
already, and the download route now says so instead of returning a broken file.

Secrets go on the Worker with `wrangler secret put`, not in `.env`.

⚠️ **One accessor for the public origin**: [src/lib/app-url.ts](src/lib/app-url.ts).
Three variables used to answer that question in different files, all falling back to
`http://localhost:3000`, so invitations, password resets, unsubscribe links, tracking
pixels and public quote links went out pointing at a developer's machine — delivered
successfully, to nowhere. `getAppUrl()` throws in production rather than guess;
`getAppUrlOrNull()` is for callers that would rather omit a link than send a wrong one.
`NEXT_PUBLIC_APP_URL` is needed twice: at build time (Next inlines it) and at runtime
(custom-worker.ts uses it as the cron base URL).

`src/lib/env-check.ts` reports every missing variable at once during boot, instead of
one cryptic failure per deploy.

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

### Tenant migrations are embedded, not read from disk

⚠️ Drizzle's migrator reads `meta/_journal.json` and the `.sql` files **at the moment it
runs**. That works from a developer's machine and nowhere else: a deployed Next.js
server does not carry files the bundler never saw imported, and a Worker has no
filesystem. Pressing *Migrate DB* in the admin panel in production failed on every
tenant with

```
Can't find meta/_journal.json file
```

So the migrations travel with the code, in
[src/db/migrations-tenant.generated.ts](src/db/migrations-tenant.generated.ts), applied by
[applyTenantMigrations()](src/db/migrate-tenant.ts). Same bookkeeping table
(`drizzle.__drizzle_migrations`), same rule — apply everything whose journal timestamp is
newer than the newest recorded — so databases migrated by the old code carry on from where
they were.

### A workspace migrates itself the first time it is used

⚠️ **The order used to matter and no longer does.** Every customer has their own
database, so a schema change lands once per customer, and the admin panel's button
applies whatever is in the **deployed** bundle. That made the sequence deploy first,
migrate second — and in the window between them the code knew about columns the
database had not got. A relational read names every column the schema declares, so
one missing column took down a whole screen. It broke production three times: the
opening-hours page, the SLA job, and creating a ticket.

[src/db/auto-migrate.ts](src/db/auto-migrate.ts) closes the window.
`ensureTenantMigrated` runs when a workspace's database handle is opened — on a
request, and in every scheduled job through `forEachTenant`, which means a deploy's
migrations land on their own within the minute. It costs one `SELECT` per workspace
per process when there is nothing to do.

Three rules it keeps:

- **It never provisions.** A database with no migration history is a new workspace,
  and building it belongs to the admin panel, which does it deliberately and reports
  what happened. Auto-migration applies pending migrations only.
- **It never fails a request.** A migration that will not apply is logged and the
  page still renders; `tolerateUnmigrated` in [src/lib/schema-ready.ts](src/lib/schema-ready.ts)
  covers the features that need the new column, and the button still works.
- **A race is survivable**, because every tenant migration is already required to be
  re-runnable. Two isolates migrating at once produce a duplicate bookkeeping row,
  and "newer than the newest recorded" does not care how many rows say the same thing.

`SKIP_AUTO_MIGRATE=1` turns it off, for when a write on a request path has to stop
without waiting for a deploy.

```bash
npm run generate:tenant-migrations   # drizzle-kit generate + embed, in one step
npm run generate:migrations          # re-embed only
npm run migrate:tenants              # apply to every tenant, from here
npm run migrate:tenants:dry          # list the tenants, change nothing
```

⚠️ **Every tenant migration must be additive.** The Neon HTTP driver has no session to
hold a transaction across statements, so a migration that fails halfway leaves the
statements before it applied and records nothing — and re-running repeats them. `ADD
COLUMN`, `CREATE TABLE IF NOT EXISTS` and guarded `UPDATE`s are safe; a destructive or
order-dependent statement is not.

`npm test` fails when the generated file and the folder disagree, because shipping code
whose columns were never created is exactly the failure that looks like a working deploy.

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

⚠️ **There are two role scales and they mean different things.** Conflating them
was the most damaging defect this codebase has had, so the distinction is now
enforced in one place:

| | Where | Who | Read it via |
|---|---|---|---|
| **Workspace role** | `tenant_members.role` | the customer's own people: `owner` > `admin` > `editor` > `viewer` | `session.user.tenantRole` |
| **Platform role** | `user.role` | Flux's own staff, who operate `/admin` across all tenants | `session.user.role` |

A workspace role is never a platform credential, and the customer-facing UI must
never write `user.role` — that was a one-click path from "tenant admin" to
"superadmin over every customer".

**Never compare a role string.** Ask for a capability:

```ts
// server action / route handler
const actor = await requireCapability("quote:write");   // throws ForbiddenError

// server component
const actor = await requirePageCapability("settings:manage");  // redirects, with a reason

// client component, from a role prop
{can(tenantRole, "record:write") && <Button>New contact</Button>}
```

The capability table lives in [src/lib/permissions.ts](src/lib/permissions.ts) —
a pure module imported by actions, pages *and* client components, which is what
stops the three layers drifting apart. Add a capability there rather than writing
a comparison at the call site. `requireWriteAccess()` and `requireAdminAccess()`
remain as aliases over `record:write` and `settings:manage`.

`viewer` is **read-only** everywhere. `src/lib/permissions.test.ts` and
`scripts/mutations/permissions.json` hold that line.

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
- **Comments are written in English.** Both languages were in use, sometimes in the same
  file, which costs the reader a language switch in the middle of an argument. English wins
  because it is already the majority. Existing Italian comments are translated when the file
  is being edited for another reason, never in a sweep of their own: some of them are quoted
  verbatim inside `scripts/mutations/*.json`, and a rewrite that misses one turns
  `npm run test:mutations` red for a reason that has nothing to do with the code.

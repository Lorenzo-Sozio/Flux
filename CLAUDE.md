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

⚠️ **It edits the source files in place**, one at a time, restoring each before the
next. So while it runs, the working tree is a lie, and anything else that reads it
gets a wrong answer with no sign that it is wrong. In one session this produced a
test failure in a file nobody had touched, and a security scanner reporting that
`api-import-auth.ts` compared a role string — the exact line that spec writes in
to prove the guard is tested. Do not run it beside a build, another test run, a
scan or a deploy, and do not trust a surprising result from any of those until it
has finished.

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
email-worker         every 10 minutes  sends queued emails; queues due follow-up sequence steps
webhook-retry        every 10 minutes  redelivers failed webhook events
campaign-scheduler   every 10 minutes  starts due campaigns
task-reminders       every 10 minutes  reminds about tasks
ticket-sla-check     every 10 minutes  flags tickets past their SLA
task-overdue-check   daily at 06:00    flags overdue tasks; tells owners of contracts due for renewal
ticket-autoclose     daily at 03:00    closes resolved tickets
idempotency-sweep    daily at 03:00    forgets Idempotency-Keys older than 30 days
```

⚠️⚠️ **The frequency of these is a database bill, not just a latency.** Serverless
Postgres (Neon here) suspends its compute after a few minutes of silence and charges
for the time it is awake. `email-worker` ran every minute, so it woke the platform
database *and every workspace's* around the clock: about 180 CU-hours a month against
a free allowance of 100, exhausted around day sixteen — on a deployment nobody was
using. Neon then answers **HTTP 402 on every query**, which reaches the screen as
"This page couldn't load" and reads exactly like a broken application. It happened on
22 September 2026.

So the five frequent jobs share one ten-minute schedule: six wakes an hour instead of
sixty, roughly 90 CU-hours a month, and a queued email leaves within ten minutes
rather than one. ⚠️ That leaves little headroom on the free plan for anything else —
browsing the dashboard wakes the same compute. A deployment on a paid plan, or one
whose database is busy anyway, should put `email-worker` back to `* * * * *`.

⚠️ Jobs share schedules rather than taking one each because the Free plan allows five
cron *triggers* per account. Another job on an existing schedule is free; a sixth
schedule is not. `src/lib/repeating-jobs.test.ts` checks this table against
custom-worker.ts, because a table that quietly stops listing a job is how somebody
concludes the job does not exist.

⚠️⚠️ **The cron is not the only thing that wakes the database — an open tab is.**
`useLivePoll` (notifications, chat) used to check back every five minutes while its
tab was hidden, and five minutes is exactly Neon's free-plan idle timeout: a dashboard
left open overnight kept the compute awake all night, for nobody. A hidden tab now
waits half an hour, which is *above* the timeout rather than on it. Anything else that
polls has to clear that bar too.

⚠️ `webhook-retry` is what makes outgoing events at-least-once instead of
at-most-once. Without it a lost event is lost, and whoever was waiting for it has no
way of knowing.

### The import API

`/api/crm/*` is the machine-to-machine surface: twenty-three routes, **all of them
POST**. It writes into the CRM and has no way to read out of it, which is a real
gap and a deliberate one to notice rather than a thing to fix casually — see the
end of this section.

**A bulk request always answers 200.** The summary carries total, created,
updated, skipped, errors and duration; `results` carries one entry per record
with its index, its status, the new id, or the field-level reasons it was
rejected. A rejected row does not fail the request. Documenting the ordinary
validation 422 on these endpoints would send an integrator looking for a status
that never arrives instead of into the body where the answer is.

⚠️ **A request with no session gets no workspace.** The proxy injects
`x-tenant-id` only when `isLoggedIn && activeTenantId`, so an API-key request has
none and `getDb()` throws. Every route here resolves the tenant itself with
`createTenantDb` — and anything it calls must be *handed* that database.

That is not theoretical. All twenty `dispatchWebhook` calls in this API omitted
it, fell through to `getDb()`, and rejected; none is awaited, so every rejection
was swallowed. An integrator importing five hundred contacts got five hundred
rows and not one `contact.created`, while the same records typed into the
dashboard fired theirs, and there was nothing to see. Eighteen also left the
origin unset — `API_ORIGIN` marks an event as written by a machine, which is what
stops an integrator receiving its own import back and reacting to it.
`src/lib/public-entry-points.test.ts` holds both lines.

⚠️⚠️ **Nothing writes inside the record loop.** Every statement on the Neon HTTP
driver is its own request, and a batch is capped at 500 inside a Cloudflare
request whose subrequest budget is 1000 — so one lookup and one write per record
made the documented maximum exactly the size that could not complete. Each route
is three passes: validate with no database, look the whole batch up in one
statement, write in chunks of `INSERT_CHUNK` (see
[src/lib/api-import-batch.ts](src/lib/api-import-batch.ts)). Five hundred records
is four statements. `onDuplicate: "update"` is the one mode still costing a
statement per record, because each row carries different values.

⚠️ **A row the batch is *going* to create counts as existing for the rows after
it.** The one-statement-per-row version got that for free: the second record
carrying an address found the first, because it was in the table by then.
`claimTracker` reserves a row before it exists, and the inserts run before the
updates so an update can target one. Without it `onDuplicate: "skip"` quietly
stops meaning what it says and a list containing the same address twice creates
the contact twice.

Ids are generated in the route rather than read back from `RETURNING`, so a
multi-row insert is never trusted to return rows in the order it was given — and
so a row can be claimed before it exists.

#### `Idempotency-Key` is what makes a retry safe

All of the above only reaches the caller if the response does. When it does not —
a timeout, a dropped connection — they know nothing, and sending the batch again
duplicates whatever the route cannot deduplicate: contacts and leads match on
email alone, email is optional for both, and the activity routes match on
nothing.

Send the header and the first request imports while every identical repeat gets
the same answer back, same ids, having written nothing, marked
`Idempotent-Replay: true`. No header, no row, and the route behaves as it always
did. Same key with a different body is a 422 — replying with the first body's
result would be worse than duplicating, because it arrives as a 200 full of ids
the caller never sent. Same key still in flight is a 409.

⚠️⚠️ **The write is the mutual exclusion.** The driver holds no session, so there
is no transaction and no lock to separate two copies of one request arriving
together. `INSERT … ON CONFLICT DO NOTHING … RETURNING` says the one thing a read
cannot: whether *this* statement created the row. Reading first and inserting
after lets both copies read nothing and both import. Taking over a key whose
handler died is the same problem, hence a compare-and-swap on the timestamp.
[src/lib/api-idempotency.ts](src/lib/api-idempotency.ts), table
`api_idempotency`, migration `0015_the_same_request_twice`.

The decision — replay, refuse, or take over — is a pure function returning
`stale` rather than a `Claim`, because "no living request is behind this row" is a
reason to *try* for the key, not permission to act as though it were held.

⚠️ **Eighteen of the twenty-three routes take the header**, the single-record
POSTs among them. The five that do not are `close`, `custom-fields`, `erasure`,
`leads/stage` and `opt-out` — a retry of any of those is still a second write.
(`find src/app/api/crm -name route.ts | xargs grep -L "claim("` is the list.)

⚠️ Reading a *list* back is still impossible, and that is the gap the response
does not close. It closes the common case: a completed request tells the caller
everything, and a repeated one tells them again. What has no answer is
reconciling weeks later against what the CRM actually holds.

#### Who wrote a row, and where that is NOT recorded

Every route here records one line per successful request in `api_write_log`
(migration `0017_who_wrote_this`): the entity, the route, the record, how many
rows, and `via` — `session` or `apikey`, straight from `authenticateApiRequest`,
which already knew and used to throw the answer away.
[src/lib/api-write-log.ts](src/lib/api-write-log.ts) is the only place that
writes it, and `src/lib/api-write-log.inventory.test.ts` reads every
route file to check they still call it. A guarantee each route has to
*remember* is one the next one would not have, and a missing line is
invisible by construction.

⚠️⚠️ **`source` is not that answer.** On lead, contact, company and order it means
*where the customer came from* — and the engine writes the channel into it on
every lead it files. An earlier version of the assistant report read provenance
out of that column, which put two questions in one field: the first workspace to
use it for its real meaning would have made the report lie, plausibly. The order
endpoint now takes `source` from the caller and leaves it null when nobody said.

⚠️ One line per **request**, not per row: a batch of five hundred is one thing
that happened and `rows` carries the size. A batch in which everything was
rejected writes nothing at all — counting it would flatter exactly the thing
being measured.

⚠️⚠️ **`/api/crm/erasure` records no `recordId`.** An identifier there would leave,
in the one table the erasure does not sweep, a way back to somebody who asked to
disappear.

`/dashboard/assistant` reads it. Not under `/dashboard/reports`, which is behind
the reporting module: whoever connects an integration needs to see what it does
whether or not they bought a reports package.

### Deploy: Vercel e Cloudflare Workers

The app deploys to either. Vercel is configured by [vercel.json](vercel.json); Cloudflare
by [wrangler.jsonc](wrangler.jsonc) + [open-next.config.ts](open-next.config.ts), through
the OpenNext adapter.

```bash
npm run cf:build     # next build + bundle the Worker into .open-next/
npm run cf:preview   # build, then run it locally on workerd
npm run cf:deploy    # build + wrangler deploy
npx wrangler types   # regenerate cloudflare-env.d.ts from the bindings
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

⚠️⚠️ **Six of the credentials are plaintext variables, not encrypted secrets.**
Checked against the account on 7 September 2026: `wrangler secret list` returns
only `CALENDAR_FEED_SECRET` and the two push keys, while `wrangler versions view`
shows `DATABASE_URL`, `AUTH_SECRET`, `PLATFORM_ENCRYPTION_KEY`, `CRON_SECRET`,
`ADMIN_SESSION_SECRET` and `IMPORT_API_KEY` among the bindings with the start of
each value in the clear. Everything works and `keep_vars` protects them from a
deploy, but anybody with dashboard or API read access reads them in full.

⚠️⚠️ **They cannot be converted from the command line.** Tested on 8 September
2026:

```
npx wrangler secret put IMPORT_API_KEY
→ Binding name 'IMPORT_API_KEY' already in use. [code: 10053]
```

The API refuses a secret carrying the name of an existing variable, so the
plaintext one has to go first — and removing it is not something wrangler can do.
There is no command to delete a var, and `keep_vars: true` exists precisely so a
deploy does not touch them. A deploy *without* `--keep-vars` would remove them,
and would take the three real secrets with it, including `CALENDAR_FEED_SECRET`
whose value is written down nowhere. That is not a route.

It is a dashboard operation: Workers → flux → Settings → Variables and Secrets,
which offers to encrypt each variable in place. In place is what matters —
deleting and then running `wrangler secret put` works too, but between the two
steps the Worker runs without that variable.

⚠️ Reading the values back is separately impossible here. `versions view`
truncates them, so the only route would be lifting the OAuth token out of
`~/.wrangler` and calling the API with it, which is indistinguishable from
credential theft and is blocked. Correctly.

⚠️ `NXTAUTH_URL` is `NEXTAUTH_URL` misspelled. No code reads it, so it breaks
nothing, but it looks like configuration that is present while the real one is
`NEXT_PUBLIC_APP_URL`. Delete it from the dashboard; `keep_vars: true` means a
deploy will not.

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

⚠️⚠️ **A binding for a resource the account does not have breaks every deploy.**
wrangler checks bindings against the account at deploy time, so declaring
`flux-documents` before R2 was enabled took production down on 4 September 2026 —
the same mechanism as the `WORKER_SELF_REFERENCE` error below, and just as quiet:
the failure is in the deploy step of a job whose build succeeded. That is why the
`DOCUMENTS` block in wrangler.jsonc is still **commented out**, and why the note
below about how to re-enable it matters more than it looks.

**This is now configured**, on 7 September 2026. R2 is enabled on the account, the
`flux-documents` bucket exists (created 4 September, the day after the deploy it
broke), and wrangler.jsonc binds it twice from a single `r2_buckets` block:

```jsonc
"r2_buckets": [
  { "binding": "NEXT_INC_CACHE_R2_BUCKET", "bucket_name": "flux-documents" },
  { "binding": "DOCUMENTS", "bucket_name": "flux-documents" }
]
```

⚠️⚠️ **One `r2_buckets` key, and never a second.** A commented-out second block used
to sit near the top of that file with instructions to uncomment it. Two keys of the
same name in one JSON object is not an error anybody reports: the later one wins and
the earlier one is silently discarded, so following those instructions would have
produced a deploy that lost either the page cache or document storage, with nothing
on screen to say which. The block is gone; the note in its place says where the real
one is.

⚠️ Uploads reach R2 only from the **next deploy** onward. Before that they fail with
a message naming what to configure, and everything else works. The alternative to R2
is any S3-compatible store, set as Worker secrets.

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

### A workspace's database does not have to be Neon

[src/db/index.ts](src/db/index.ts) picks the driver from the connection string: Neon's
HTTP driver for `*.neon.tech`, a pooled TCP connection (`pg`) for anything else. The
declared type stays `NeonHttpDatabase` because every action is written against it and
the query builders are identical.

⚠️⚠️ **`db.batch([...])` must stay atomic.** On Neon it maps to the transaction
endpoint; the pooled driver has no `batch`, so one is built from a real transaction on
a single connection, running each statement as SQL. Running the *builders* inside the
transaction would not work: a builder is bound to the pool and takes its own
connection, committing outside the transaction it was meant to be part of.

⚠️ **TLS is pinned, not disabled** ([src/lib/db-ssl.ts](src/lib/db-ssl.ts)). Managed
Postgres over TCP (Railway among them) presents a self-signed certificate whose leaf
says `CN=localhost`. `rejectUnauthorized: false` would keep the encryption and accept
any certificate, which on a public endpoint is an invitation; instead the issuer is
pinned and only the hostname check is relaxed. `npm run db:ca <url>` prints the
current root when a provider rotates it, and `DATABASE_CA_PEM` overrides it.

⚠️⚠️ **`pg-cloudflare` is a direct dependency, and must stay one.** `pg` requires it
by name to open a TCP socket on Workers and declares it *optional*, so a clean CI
install can leave it out — and the Worker bundle then fails at its last step with
`Could not resolve "pg-cloudflare"`, after a Next build that succeeded. Declaring it
outright fixes that.

⚠️⚠️ **Do not replace it with a stub.** That was tried, on 23 September 2026, to make
the resolution independent of npm's flags — and it deployed, and every query in
production started throwing: the Worker really does use it to reach Railway. The two
other routes tried the same evening are dead ends worth not repeating: loading `pg`
through `createRequire` (Turbopack follows the literal into the bundle anyway) and
building the specifier at runtime (defeats every bundler, and Turbopack's own loader
with it: "Cannot find module as expression is too dynamic").

⚠️⚠️ **On Workers the pinned CA is not applied.** `sslFor` hands `pg` a certificate
authority and asks for verification; `CloudflareSocket` opens the connection through
`cloudflare:sockets`, which takes no CA, so on Workers the traffic is encrypted and
the server is **not** authenticated. It is verified in Node — the dev server, the
scripts, Vercel. Closing that gap on Workers means Hyperdrive, which terminates TLS
itself, or a database whose certificate a public root signs (Neon's is).

⚠️ Whether `pg` works on **Cloudflare Workers** is unverified: the bundle builds, but
the runtime has not been exercised. A deployment on Workers pointed at plain Postgres
has to be tried before it is trusted (`npm run cf:preview`), and Hyperdrive is the
documented route if it does not.

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

`src/db/migrations-rerun.test.ts` holds that line: it applies every embedded
migration to a real Postgres (PGlite, in-process) and then runs each one a second
time. `0002_odd_ulik` predates the rule and is the one named exception.

`npm test` fails when the generated file and the folder disagree, because shipping code
whose columns were never created is exactly the failure that looks like a working deploy.

### Follow-up sequences

Steps of "wait so many days, then send this", walked through by an enrollment per
person. Rules in [src/lib/sequence-plan.ts](src/lib/sequence-plan.ts), carrying
out in [src/lib/sequence-runner.ts](src/lib/sequence-runner.ts), migration
`0021_until_they_answer`.

⚠️⚠️ **Four one-line hooks in files that are otherwise about something else**, and
removing any of them breaks nothing visible — sequences simply keep writing:

- the email worker calls `advanceSequences` before claiming what to send;
- `processInboundEmail` calls `stopOnReply` before any early return;
- the Resend delivery webhook stops sequences on a bounce or complaint, and finds
  the workspace through `email_job.message_id` for emails that are not campaigns;
- `/api/unsubscribe` understands the `seq:` token and stops sequences on a
  campaign unsubscribe too.

`src/lib/sequence-hooks.test.ts` reads all four.

⚠️ **Replies are detected only where inbound email is configured**
(`RESEND_INBOUND_WEBHOOK_SECRET` or `INBOUND_EMAIL_SECRET`). Without it a sequence
cannot know somebody answered; the sequences page says so rather than letting it
look like the feature works.

⚠️ An enrollment sends only to the address it was enrolled with, and one active
enrollment per sequence and address is a partial unique index, not a check. Both
exist because two people racing to enroll the same lead, or two merged records,
would otherwise receive every step twice.

⚠️ An automatic reply (out of office) counts as a reply and stops the sequence.
That is the safe direction to be wrong in; telling the two apart needs headers
the inbound payload does not carry today.

### The FatturaPA file

[src/lib/fatturapa/](src/lib/fatturapa/) builds the XML an issued invoice is sent
to SDI as: `totals.ts` for the figures, `xml.ts` for the document, `schema/` for
the official XSD.

⚠️⚠️ **Validity is checked against the published schema, not against a reading of
it.** `Schema_VFPR12_v1.2.3.xsd` (specifications 1.4) and the W3C signature schema
it imports are vendored byte for byte, their hashes pinned in the test, and
libxml2 compiled to WebAssembly validates every fixture. A schema updated by the
Agenzia is then a red test with a name, not a batch of invoices rejected weeks
later.

⚠️⚠️ **Invoice arithmetic is not `document-totals.ts`.** Quotes and orders round VAT
per line and spread the header discount inside the lines; SDI recomputes VAT per
rate and requires ImponibileImporto to equal the sum of the lines' PrezzoTotale.
So `invoiceTotals` groups by (rate, Natura), computes VAT once per group, and
writes the document discount as one negative line per group, shared to the cent.
The draft screen, the issued totals, the stamp duty base and the XML all read it.

⚠️ Text is restricted to Basic Latin and Latin-1: "€", typographic quotes and
emoji reject the whole file, so `latin()` replaces them. Element order inside each
block is part of the schema — reordering is a rejection.

⚠️ The file is built from what the invoice froze at issue, never from the records
as they are now: `/api/invoices/{id}/xml` returns the same bytes next year.

#### Credit notes (TD04)

⚠️⚠️ **What is left to credit is decided by the issuing statement.** `credit` in
[src/lib/invoice-issue.ts](src/lib/invoice-issue.ts) advances the original invoice's
`credited_amount` only while `total - credited_amount` covers the note, and `next`
numbers the note only if `credit` did. The condition sits on the row being
updated, which Postgres re-checks after waiting for a concurrent writer; a check
in a separate query, or a subquery in the same statement, reads the old figure
and lets two notes take the same remainder. Migration `0027_what_was_given_back`.

⚠️ A credit note never recharges stamp duty (`rechargesFor`): the recharge line
would hand the €2 back to the customer.

#### The courtesy PDF and the archive

[src/lib/invoice-archive.ts](src/lib/invoice-archive.ts) keeps both files of an
issued invoice in object storage: the XML, and the PDF from
[src/lib/pdf/invoice-pdf.ts](src/lib/pdf/invoice-pdf.ts). Migration
`0025_kept_as_it_was_sent` adds the keys, their SHA-256 and when a copy was emailed.

⚠️⚠️ **Written once, and the write decides.** Each archiving request uploads under
fresh random keys, then records them with an update that applies only while
`xml_key IS NULL`; the loser deletes its own objects. Nothing is overwritten.

⚠️ **Archiving never fails an issue.** It runs in `after()` once the number is
assigned; a failure is logged, the download routes build the file from the
snapshots and archive it then, and the invoice page offers "Archive now".

⚠️ An archived object whose bytes no longer match the stored hash is **not
served**: the file is rebuilt from the snapshots and the mismatch logged.

⚠️ The PDF says on every page that it has no fiscal value. It is not the invoice,
and this archive is not *conservazione sostitutiva*.

`src/lib/invoice-archive.test.ts` runs on PGlite with an in-memory store;
`scripts/mutations/invoice-archive.json` breaks the conditional record, the
hash check and the draft refusal.

### PDFs are drawn with pdf-lib, never @react-pdf

⚠️⚠️ **@react-pdf/renderer cannot run on Workers.** Its layout engine is Yoga
compiled to WebAssembly and instantiated from bytes at runtime, which Workers
forbid ("Wasm code generation disallowed by embedder"). It rendered perfectly in
Node and in every test, and every quote and invoice PDF answered 500 in
production — found on 16 September 2026 by tailing the Worker, not by any test.
[src/lib/pdf/](src/lib/pdf/) draws with pdf-lib, which is plain JavaScript;
`src/lib/pdf/pdf.test.ts` fails if @react-pdf comes back.

⚠️ The standard fonts encode WinAnsi only, and one character outside it (an
emoji, "−", Intl's narrow no-break space) throws. `canvas.clean` replaces them.

⚠️ A library that works in `npm test` is not evidence it works on Workers. Anything
that renders, compresses or parses with WebAssembly has to be tried on the Worker
itself (`npx wrangler tail flux`).

### Documents: the customer's language and the document's currency

[src/lib/document-language.ts](src/lib/document-language.ts) decides both.

⚠️⚠️ **A document follows the customer, not the reader.** The quote PDF, its print
view, the public page, the quote email and the invoice courtesy copy read
`company.language` ("it" | "en"; null means from the country: Italy or none is
Italian). The dashboard follows the signed-in user's locale; these never do.
The texts are in that file, not in messages/*.json, because react-pdf, HTML
strings and emails have no next-intl — `document-language.test.ts` checks both
languages carry every key.

⚠️⚠️ **`formatAmount` converts; `formatMoney` does not.** `useCurrency().formatAmount`
treats a number as EUR and converts it to the viewer's display currency, which
is right for workspace totals and wrong for a document: a euro quote shown to a
user whose switcher once said USD became a different number with a $ in front.
Quotes, orders, contracts and invoices use `formatMoney(amount, doc.currency)`.
Totals across documents are grouped by currency, never summed across them.

⚠️ An invoice freezes the language in `customer_snapshot`, so a courtesy copy
reprinted next year does not change language with the record.

### Mobile and the installable app (PWA)

```bash
npm run mobile:audit      # the mobile hazards that can be found by reading
npm run generate:icons    # re-render the app icons from scripts/generate-pwa-icons.mjs
```

Flux installs to a phone's home screen: [src/app/manifest.ts](src/app/manifest.ts)
(served at `/manifest.webmanifest`), icons under `public/icons/`, and a `viewport`
export in the root layout that declares `viewport-fit=cover` — without which every
`env(safe-area-inset-*)` is zero and the bottom bar sits on the home indicator.

⚠️ **A maskable icon is different artwork, not the same PNG relabelled.** The
launcher crops the outer 20% to whatever shape the device draws, so the mark has
to sit well inside that. `scripts/generate-pwa-icons.mjs` renders both.

#### ⚠️⚠️ The service worker caches the shell and never a customer's data

[public/sw.js](public/sw.js) precaches exactly one page (`/offline`) and serves
content-hashed `/_next/static/` and `/icons/` from disk. **Every navigation, every
API call and every RSC payload goes to the network.** This is a decision, not an
omission, and the reasoning is at the top of that file:

- **Tenant.** One browser signs into two workspaces. Cache Storage knows nothing
  about the `x-tenant-id` header that produced a page, so a cached
  `/dashboard/crm` is one customer's figures shown to another — and it looks
  exactly like a working page.
- **Permissions.** What a page contains depends on who asked. A cached copy
  outlives a role change and a revoked membership.
- **Staleness.** A pipeline twenty minutes old is worse than absent, because
  nothing on the screen says so and somebody quotes from it.

⚠️ The worker never calls `skipWaiting()` on its own. A deploy that takes effect
mid-sentence reloads the tab under whoever is typing a quote;
[service-worker-registrar.tsx](src/components/pwa/service-worker-registrar.tsx)
offers the reload instead. Registration is production-only.

`VERSION` in sw.js purges every older `flux-*` cache on activate; bump it when the
worker's own logic changes.

#### Web push: the one thing the worker does when no tab is open

```bash
npm run generate:vapid    # a VAPID keypair, once, for the whole deployment
```

The notification bell polls: every 30 seconds while a tab is in front of
somebody, every five minutes while it is not, and never once it is closed. So an
SLA breach at 3am was written down faithfully and reached nobody. Web push closes
that: `createNotificationAction` and `createNotificationsBatch` write the row and
then call `announce()` from [src/lib/push-send.ts](src/lib/push-send.ts), which
runs behind `after()` and delivers to whatever devices the person signed up.

Hooking it into those two functions rather than into each of the twelve callers
is deliberate — a second list of "events that push" is exactly the thing that
drifts from the first.

**The row in the database stays the record; a push is the doorbell.** Delivery is
best-effort, unordered, and nothing on this path may throw: it runs behind a
server action, and an exception here would surface to somebody as a failed save
of something that in fact saved.

⚠️ **Not the `web-push` npm package.** [src/lib/web-push.ts](src/lib/web-push.ts)
implements RFC 8291 payload encryption and RFC 8292 VAPID against Web Crypto,
because `web-push` reaches for Node's `crypto` and `https` and this repository
also runs on Workers. The failure mode of a half-working polyfill here is the
worst one available: the send returns, nothing is logged, and no notification
ever arrives.

⚠️⚠️ **Every mistake in that file is silent.** A wrong info string, the two public
keys in the wrong order, `0x01` instead of `0x02` as the record delimiter — all of
them produce a body that encrypts, sends, and comes back **201**, because the push
service is not the thing that decrypts it. `src/lib/web-push.test.ts` decrypts
what we send with the RFC's byte strings *typed in by hand*, so a round-trip
cannot pass by sharing a mistake with the encryptor. `scripts/mutations/web-push.json`
breaks each one in turn.

⚠️ **Not every notification pushes.** The catalogue is in
[src/lib/push-types.ts](src/lib/push-types.ts): of its fourteen types, six default
to on — `lead_assigned`, `task_due`, `sla_warning`, `sla_breach`,
`contract_renewal` and `sequence_reply` — and the other eight default to off, and
a person changes any of them at `/dashboard/settings/notifications`. A type not in
that catalogue never pushes — it still reaches the bell. Preferences are stored as
*overrides* rather than as a list of enabled types, so a thirteenth type added
later does not arrive silently switched off for everyone who ever opened the
screen.

⚠️ **A 410 means gone forever.** A reinstalled browser or a revoked permission
answers 410 on every future send, so the subscription row is deleted the moment
one appears. Left in place, the table only grows and every notification for that
person becomes a fan-out of guaranteed failures.

⚠️ **On iPhone and iPad push only works for an app added to the home screen.**
`PushManager` exists in a Safari tab and `subscribe()` throws, so feature
detection alone is not enough; the settings screen checks `display-mode:
standalone` and explains, because otherwise the switch looks broken.

⚠️ **The VAPID public key is served by a server action, not `NEXT_PUBLIC_*`.**
Next inlines those at build time, and the Cloudflare build does not have the
runtime variables — an empty key compiled into the bundle would make
`pushManager.subscribe` fail on every device, long after anybody was looking at
the build.

⚠️ **Generate the keypair once.** Rotating it does not re-key anything: existing
subscriptions hold endpoints the new private key cannot write to, they answer 403
forever, and everyone has to turn notifications on again. `PUSH_VAPID_PUBLIC_KEY`
and `PUSH_VAPID_PRIVATE_KEY` are Worker secrets on Cloudflare. Without them the
product behaves exactly as before and the settings screen says so — push is
optional, and its absence is not an error.

⚠️ **Every push must show a notification.** The subscription is taken with
`userVisibleOnly: true`; receiving one and staying silent makes Chrome display
its own "site updated in the background" message and, repeated, revokes the
permission. Hence the fallback branch in the worker's `push` handler.

The devices table is tenant-scoped (`push_subscription`, `notification_preference`,
migration `0014_a_phone_can_be_told`), so it arrives through the same
auto-migration as everything else.

#### Below `md` the layout is different, not narrower

- **A bottom tab bar** ([mobile-tab-bar.tsx](src/app/(main)/dashboard/_components/sidebar/mobile-tab-bar.tsx)),
  four destinations plus the menu. ⚠️ Its entries come from `pickMobileTabs`,
  which orders the **already filtered** menu and adds no permission rule of its
  own — a second copy of that rule is what would drift. `scripts/mutations/filter-nav.json`
  holds that line.
- **Lists are cards, not tables** ([record-cards.tsx](src/components/crm/record-cards.tsx)).
  A nine-column table does not become usable by scrolling sideways. Contacts,
  companies, leads, orders, quotes and tickets render cards below `md` and the
  original table from `md` up.
- **Dialogs fill the screen.** Nearly all of them are forms, and a full-screen
  scroll container is also what makes the virtual keyboard behave: a sheet pinned
  to `bottom-0` has the keyboard open underneath it on iOS.

⚠️ **`vh` is wrong on iOS Safari** — it measures the window *without* the address
bar, so `max-h-[90vh]` is taller than the screen and the buttons under it cannot
be tapped. Use `dvh`. `npm run mobile:audit` fails on any `vh`.

⚠️ **The dashboard layout wrapper is the only owner of page padding.** It used to
add `p-4`/`p-6` on top of the `p-6` that 39 pages set on their own root. A new
page sets none.

⚠️ **`opacity-0 group-hover:opacity-100` is a missing feature on a phone**, not a
subtle one: there is no hover, so the control never appears. A rule under
`@media (hover: none)` in globals.css reveals all of them; a touchscreen laptop
still has hover and keeps the reveal.

⚠️⚠️ **The thing that actually pushes content off a phone is `min-width: auto`.**
A flex child will not shrink below its own content, so a long title in a
`justify-between` row does not elide — it grows, and the buttons beside it go
past the edge of the screen. Twenty-two headers did this. The fix is always
`min-w-0` on the text block plus a gap; `npm run mobile:audit` looks at the line
*after* a flex row to find the next one.

⚠️ **Two columns of form fields is 160px a field.** Labels wrap, placeholders are
cut off mid-word, and a date input has no room for the picker the browser draws
over it. Form grids are `grid-cols-1 sm:grid-cols-2`, and every `col-span-2`
inside one carries the same breakpoint — a span of two on a one-column grid makes
the browser invent a second column, which is the overlap it was meant to remove.

⚠️ `overflow-hidden` on a table's wrapper does **not** contain the table. It cuts
the columns off with no way to reach them. Use `overflow-x-auto`. (The `Table`
primitive already wraps itself; a hand-rolled `<table>` does not.)

⚠️⚠️ **The safe area on a full-screen dialog is an inset, not padding.** Seventeen
of the twenty dialogs pass `p-0` so they can draw their own header and footer
bars, and padding is exactly what `p-0` removes — so every one of them put its
header under the notch. `top-[var(--safe-top)] bottom-[var(--safe-bottom)]` is
something a class on the content cannot undo.

⚠️ **`flex-1` is `flex: 1 1 0%`**, so a width on that element is ignored and its
`min-w` becomes its *actual* width. The pipeline board's `min-w-[280px]` columns
were therefore all exactly 280px: one per screen, with no edge of the next one to
say the board scrolls.

⚠️ **`w-72` is 288px** — the scale form of a fixed width is as wide as the bracket
form, and it is how every side panel is written. `npm run mobile:audit` reads
both.

⚠️ **A fixed height with `items-center` and no overflow clips the *top*.** Centring
pushes what does not fit out of both ends and only the bottom one can be scrolled
to. On a phone a form exceeds the viewport the moment the keyboard opens, so five
auth pages were losing their own heading and first field.

The menu trigger is **first on the left of the header at every width**, because
that is the edge its panel comes out of; the bottom bar below `md` is five
*destinations* and holds no menu button. `interactive-widget=resizes-content` in
the root viewport makes the keyboard shrink the layout rather than cover it — on
Chrome and Android; iOS ignores it, which is why full-screen dialogs are ordinary
scroll containers rather than sheets pinned to the bottom edge.

Touch targets go to 44px under `(pointer: coarse)`; form controls go to 44px below
`md` — scoped to *width* there rather than to pointer type, because the dense
nine-column line editor on an order is a deliberate desktop layout a touchscreen
laptop should keep.

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

### Price lists

[src/lib/price-list.ts](src/lib/price-list.ts) decides what a customer pays: a price
written for that product in their list wins, otherwise the list's percentage moves the
catalogue price. Tables `price_list` / `price_list_item`, `company.price_list_id`,
migration `0028_what_this_customer_pays`.

⚠️⚠️ **The percentage is a direction, not a discount.** `adjustmentPercent` −10 is ten
per cent off, +5 is five per cent on top — the opposite convention to every
`discountPercent` beside it, which is why it is named differently.

⚠️ **Nothing reaches back into a document.** Quote, order and invoice lines store their
own `unitPrice`; a list changed today does not rewrite what was sent last month, and
changing the customer on an open form never overwrites a price somebody typed.

⚠️ A list carries no currency, because a product's price carries none either.
`scripts/mutations/price-list.json` breaks the sign, the override, the zero price and
the rounding.

### One registry of entities

[src/lib/entities.ts](src/lib/entities.ts) lists every kind of record once. Global
search (one provider per type in `src/lib/search/providers.ts`), quick create and the
recents list all read it. ⚠️ A new section is added **there**, not in three menus:
`src/lib/entities.test.ts` fails when a type has no provider, no translation, a link to
a page that does not exist, or a `[id]/page.tsx` without `<RecordVisit>`.

### Pipeline filters

Every page under `/dashboard/pipeline` reads the same URL parameters —
`owners=a,b,none|all`, `period`, `status`, `q` — parsed and turned into SQL by
[src/lib/pipeline-filters.ts](src/lib/pipeline-filters.ts), drawn once by the section
layout. ⚠️ `none` is `IS NULL`, never `IN (NULL)`. `PIPELINE_VIEWS` says which controls
each page has; a new page goes there.

### Translations are checked on the screens, not only in the files

`src/i18n/coverage.test.ts` runs `scripts/i18n-audit.mjs` (text typed into a component)
and `scripts/i18n-keys-check.mjs` (a `t("key")` missing in either language). Zod
messages are `validation.*` keys translated by `FormMessage` / `useMessageText`;
messages a server action *returns* go through `serverT` in
[src/lib/i18n-server.ts](src/lib/i18n-server.ts). A thrown message never reaches the
screen in production, so it is not the place for user-facing text.

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

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

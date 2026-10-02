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

⚠️⚠️ **A test that goes red on *any* edit makes every mutation look caught.**
`src/lib/mutation-specs.test.ts` checks that each spec's `find` is still in its file —
and a mutated file, by definition, no longer contains it. For as long as the runner
ran it, every mutation of every spec reported "caught" regardless of the real tests.
The runner now sets `FLUX_MUTATION_RUN=1` and that test stands aside; anything else
that reads specs or source text wholesale must do the same. The honest check on a
runner is a mutation that *must* survive (rewrite a comment) and does.

⚠️ **Change a line a mutation breaks, and update the spec in the same change.**
`src/lib/mutation-specs.test.ts` (in `npm test`) fails when a spec's `find` no longer
matches exactly once: a spec that cannot be applied proves nothing and fails nothing.
Fifteen had rotted that way before the check existed.

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
task-reminders       every 10 minutes  reminds about tasks; sends the reminder set on each appointment
ticket-sla-check     every 10 minutes  flags tickets past their SLA
sdi-status           every 10 minutes  reads what SDI said about invoices handed to the intermediary
task-overdue-check   daily at 06:00    flags overdue tasks; tells owners of contracts due for renewal;
                                        sends the morning digest (src/lib/morning-digest.ts);
                                        runs the `onSchedule` automation rules (src/lib/scheduled-rules.ts)
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

`/api/crm/*` is the machine-to-machine surface: twenty-three routes that write, and
five that read — `GET` on contacts, leads, companies, deals and orders, a page at a
time by (updated_at, id) with `updatedSince` ([src/lib/api-read.ts](src/lib/api-read.ts)).

⚠️⚠️ **Every route passes `gateApiRequest(req, SCOPE)`**, never the bare
`authenticateApiRequest`: the first says who is calling *and* whether what they hold
covers this route. Keys are made in Settings → API with a name and scopes per entity,
`contacts:read`, `orders:write` ([src/lib/api-scopes.ts](src/lib/api-scopes.ts),
decision D7). They live in the **tenant** database (`api_key`, migration
`0047_what_a_key_may_do`) and read `flx2.<workspace id>.<secret>`, so the gate knows
where to look; the registry is migrated by hand, and a table missing there would have
refused every integration at once. Write does not imply read. The single key from
before scopes and the platform `IMPORT_API_KEY` keep exactly what they had — write
everything, read nothing — so the read API did not hand every old key the database.
`src/lib/api-scopes.inventory.test.ts` holds each route to its scope.

⚠️⚠️ **A signed-in person needs on the API what they need on the screens.** A session carries
no scopes, and `record:write` alone let an editor subscribe a URL to every event with the
workspace's signing secret, or erase a person. `SESSION_NEEDS` in
[src/lib/api-import-auth.ts](src/lib/api-import-auth.ts) maps webhooks, privacy, quotes and
orders to the dashboard's capability for the same act.

⚠️⚠️ **A subscription belongs to the key that made it** (`webhook.api_key_id`, migration
`0054_whose_subscription`): revoking the key switches its subscriptions off, and a key removes
only its own. A leaked key's event stream used to outlive the key.

⚠️ **`X-Tenant-ID` reaches the API as `x-flux-claimed-tenant`.** The proxy strips
`x-tenant-id` from every request (only its own may reach a route), which left the platform
key unable to name any workspace; it now passes the client's claim on under that name, and
the API checks it against the key like before. Never the session's header as a claim.

⚠️ `updatedAt` on contacts, leads, companies, deals and orders is refreshed by the schema
(`$onUpdate`) on every Drizzle update: `updatedSince` reconciles by it, and most edits used
to leave it alone — an integration never saw them.

⚠️ A read cursor carries `updated_at::text`, not a JavaScript Date: milliseconds
against microseconds would serve the last row of every page again.

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

⚠️⚠️ **The rules go through `runRulesAfterApiWrite`, never `runAutomations`.** Same
failure, one layer over: four routes called the engine bare inside `after()`, it
read its rules through `getDb()`, and every rule an integration should have set off
failed unseen. The helper ([src/lib/api-automations.ts](src/lib/api-automations.ts))
runs them inside `runWithTenant`. Every **single-record** route fires them, as the
same gesture in the dashboard would; the **bulk** routes fire none, on purpose — an
import is a migration, not an event, and the API docs say so. The entry-point test
holds all three.

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

The dashboard's CSV import ([src/lib/csv-import.ts](src/lib/csv-import.ts), the wizard in
[import-wizard.tsx](src/components/crm/import-wizard.tsx)) keeps the same three passes. Its
`onDuplicate: "update"` does **not** cost a statement per row: each chunk of patches goes as
one JSON array laid over the rows with `jsonb_populate_record`. ⚠️ `to_jsonb(cur) || (e.x -> 'patch')`
needs those brackets — `||` and `->` bind alike, and without them nothing is updated.
The wizard's preview is the same plan with `dryRun`, never a guess made in the browser.

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
the caller never sent. Same key still in flight is a 409. ⚠️ A replay carries the first
answer's **status** too (a 201 is not a 200): `remember` stores it beside the body.

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

The response closes the common case: a completed request tells the caller everything,
and a repeated one tells them again. Reconciling weeks later is what the read routes
are for — with a key that has the `:read` scope. A deleted record is absent from them;
the `*.deleted` webhooks say it went.

#### Events, the public reference, Zapier and Make

⚠️⚠️ **`dispatchWebhook` is not a server action and must never become one.** It lived in
`src/actions/webhooks.ts`; every export of a `"use server"` file is an endpoint any
signed-in browser can call, so a read-only member could send any event, with any payload,
signed with the workspace's secret, to every integration listening. It is in
[src/lib/webhook-dispatch.ts](src/lib/webhook-dispatch.ts) now, and
`src/lib/webhook-events.test.ts` fails if a `"use server"` file exports it again.

It takes only names from the catalogue ([src/lib/webhook-events.ts](src/lib/webhook-events.ts)),
which the webhook settings screen also reads: the screen used to offer ten events while the
code sent fifteen, and tickets and invoices sent none. A rule's own events go through
`dispatchRuleEvent`.

**One source for the public API reference**:
[src/lib/api-docs/public-api.ts](src/lib/api-docs/public-api.ts). The staff page at
`/admin/api-docs`, the public page at `/developers` and `/api/openapi.json` all read it,
and the staff spec's `/api/crm` half is generated from it. `src/lib/docs-alignment.test.ts`
holds every entry to its route, method and scope.

Zapier and Make need REST hooks: `POST /api/crm/webhooks` subscribes, `DELETE
/api/crm/webhooks/{id}` unsubscribes (scope `webhooks:write`, at most fifty). ⚠️ A key removes
only a subscription a key made — one with no owner — never what an administrator set up.
Publishing an app on either marketplace needs an account there and is not in this repository.

#### Flux for the assistant (D-A)

⚠️ **D-A was revised on 30 September 2026.** Flux will get its own model as the operator's
**copilot**: drafts, summaries, extraction and proposals, each confirmed by a person, and nothing
sent to a customer by itself (Fase 5, C0–C9, in
[docs/valutazione-prodotto-2026-09.md](docs/valutazione-prodotto-2026-09.md) §18; design in
[docs/ia-copilota-in-flux-o-voipai-2026-09.md](docs/ia-copilota-in-flux-o-voipai-2026-09.md)).
Only the provider layer is built ([src/lib/ai/](src/lib/ai/), see "The copilot's model" below):
nothing calls it yet, so no model runs inside Flux until the first task lands. End-to-end autonomy stays with
**VoipAI**, the owner's AI engine, which works with customers on voice, WhatsApp, SMS and email
and writes here through this API. Flux is where that work is seen and controlled:

- **`origin.key`** on every event names the key that wrote (`apiOrigin`,
  [src/lib/webhook-envelope.ts](src/lib/webhook-envelope.ts)). ⚠️ An integration drops its
  own writes by that id — dropping every `via: "api"` would also drop what every other
  integration did.
- **`consent.withdrawn`** ([src/lib/consent-events.ts](src/lib/consent-events.ts)) goes out
  on every refusal — the unsubscribe link, `/api/crm/opt-out`, the record page — with the
  address at the top of the payload. From the link and the API it goes out even when the
  consent here was already false: the act is what the other systems must honour.
  ⚠️⚠️ `channel` says what was refused: `email` (the link), `marketing` (the consent unticked on
  the record — promotion stops, the follow-ups the person asked for go on), `all`
  (`/api/crm/opt-out`). Decided 27 September 2026: two purposes, not one.
- **«Seguito dall'assistente»**: `POST /api/crm/assistant` marks every record of a person
  (`assistant_since`/`assistant_name`, migration `0048_the_assistant_has_them`). ⚠️⚠️ Every
  automatic audience leaves them out — sequences refuse or stop (`with_assistant`), campaign
  sends, segments and counts add `notWithAssistant`. A new automatic mailer must too, or the
  same person is written to by both systems. ⚠️ A mark belongs to the key that set it
  (`assistant_key_id`, migration `0055_whose_assistant`): another key's change is a 409, a
  signed-in administrator may change any.
- **Reads to work the business's way**: `GET /api/crm/pipelines` (stages with their kind) and
  `GET /api/crm/products?companyId=` (the customer's price, from
  [src/lib/price-rules-load.ts](src/lib/price-rules-load.ts), the loader the dashboard uses too).
- **`POST /api/crm/quotes`** ([src/lib/quote-draft.ts](src/lib/quote-draft.ts)): a **draft**
  whose lines name products and whose prices Flux computes. ⚠️⚠️ A line without a product is
  refused — its price would be made up — and nothing is sent: the deal's owner is notified and
  decides.

⚠️⚠️ **`WRITE_ALL` is written out, never derived.** Derived from the list of entities, it
handed every key from before scopes each new write scope — `webhooks:write` among them,
and a subscription to every event is a way to read everything. A scope added later is for
keys made later; `api-keys.test.ts` pins the eight.

⚠️⚠️ **An update keeps the source the record has.** The insert builders default `source` to `"api"`;
every update path goes through `asUpdate` ([src/lib/api-import-validators.ts](src/lib/api-import-validators.ts)),
which leaves it out when the caller sent none — a Meta lead sent again by Zapier used to become an
"api" lead. `api-import-validators.test.ts` holds the six routes to it.

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

### The copilot's model: one shape, any provider

[src/lib/ai/](src/lib/ai/) (Fase 5, C0). A task calls `aiGenerate("summary", request)`,
`aiStream(...)` or `aiGenerateJson(...)` from [client.ts](src/lib/ai/client.ts) and never names a
vendor. Each provider is one file implementing `AiProvider` ([types.ts](src/lib/ai/types.ts)) and one
line in [registry.ts](src/lib/ai/registry.ts): Gemini ([gemini.ts](src/lib/ai/gemini.ts)) and OpenAI
([openai.ts](src/lib/ai/openai.ts), the Responses API).

- ⚠️⚠️ **The model is configuration, not code** ([config.ts](src/lib/ai/config.ts)):
  - `AI_PROVIDER` / `AI_MODEL` set every task; the defaults are `gemini` and `gemini-2.5-flash-lite`.
  - `AI_MODEL_<TASK>` and `AI_PROVIDER_<TASK>` route one task elsewhere.
  - `AI_MODEL` belongs to `AI_PROVIDER`: a task routed to another provider does not inherit it.
  - No key means **off** (the copilot is not offered). Something configured wrongly means
    **config**, which says what is wrong instead of passing it off as "not available".
- ⚠️ **Google keeps the 2.5 models to keys that already used them.** A new key gets 404, reported
  as `model`: the fix is `AI_MODEL` (e.g. `gemini-3.5-flash-lite`), not the code.
- ⚠️ **Plain `fetch`, no SDK**, like SDI and the mailboxes: it runs on Workers, costs the bundle
  nothing, and tests hand in their own. The fetch is called through a closure, because on Workers
  a detached `fetch` throws.
- ⚠️⚠️ **Failures come back in Flux's words** (`auth`, `model`, `blocked`, `rate_limited`,
  `unavailable`, `output`…), never thrown, and **never carrying the request**, which holds a
  customer's words.
- ⚠️ **A structured answer is checked, not trusted.** `aiGenerateJson` parses and validates every
  answer; one that does not fit or was cut at the token ceiling is an `output` failure.
- **Every provider must drop its model's thinking from the text**; Gemini's comes back as parts marked
  `thought`.
- **Data:** a paid Gemini key (Google does not train on paid traffic). The Developer API cannot
  choose where a request is processed; processing in the EU means Vertex AI, which would be one
  more provider file.
- **OpenAI** (`AI_PROVIDER=openai`, `OPENAI_API_KEY`; with no `AI_PROVIDER` the provider whose key
  is set is used): `store: false`, so OpenAI keeps nothing of a call. ⚠️⚠️ A GPT-5 / o-series model
  thinks out of `max_output_tokens` and refuses `temperature`: it gets a thinking allowance on top
  of the task's ceiling and `reasoning.effort` low (`OPENAI_REASONING_EFFORT`), and a message marked
  `phase: "commentary"` is its working, never the answer. A JSON schema whose properties are all
  required is sent `strict`. No real key has been through it yet.

**Who may use it: four keys** ([access.ts](src/lib/ai/access.ts)). A task goes through `runAiTask` /
`runAiJsonTask` ([run.ts](src/lib/ai/run.ts)), never `aiGenerate` directly, and it checks them in order:
1. **The deployment:** a provider must be configured.
2. **The plan:** active, with the **AI copilot flag** set in /admin/plans (Features tab). There is no
   fixed plan that includes it: the flag is stored as the `ai` module in `enabled_modules`, so the
   usual gates (`requirePlanModule("ai")`, `requireModuleAccess`) work on it unchanged.
3. **The workspace:** its `ai` switch (Settings → Features), shown only when the plan offers the copilot.
4. **The month:** `aiRequestsPerMonth` in the plan's limits, counted before the call in
   `billing_usage_stat`.

- ⚠️⚠️ **A plan saved before the copilot has no `aiRequestsPerMonth`: that reads as 0**
  (`effectiveLimits`), while `null` is "unlimited", chosen explicitly. `?? 0` would erase that difference.
- The caller needs `record:write`. Every call is logged in `ai_suggestion` (migration `0069`,
  [suggestions.ts](src/lib/ai/suggestions.ts)): who asked, which record, model, tokens, the proposal as
  shown (never the prompt) and its outcome.
- The outcome (accepted, edited, discarded) is decided once, by whoever asked, through
  `decideAiSuggestionAction`. That rate is the measure that may one day justify automation.
- ⚠️ **The erasure deletes the person's proposals** (on their lead or contact), like their field history.

**The first tasks** (C1–C3), in [src/actions/ai.ts](src/actions/ai.ts):
- **Summary** of a record or a ticket: `AiSummaryCard`.
- **Briefing** for an appointment: `AiBriefing`, in the calendar sheet.
- **Email draft or rewrite**: `AiEmailDraft`, inside `SendEmailModal`, for contacts, leads and deals. On a
  deal the dialog writes to its contact, drafts from the whole deal and logs the email on both.

Pages ask `aiEntries([...], aiViewer(session.user))` what to show for each control, and nothing
reaches the model until the person presses the button:
- **ready**: everything is in place;
- **disabled, with the reason**: the plan lacks the flag (the customer can upgrade), or — for Flux's
  own staff only — the deployment has no provider or a wrong one (set `GEMINI_API_KEY`);
- **hidden**: a workspace switched off by its administrator, an inactive subscription, or a
  deployment without a provider seen by a customer (`entryFor`).

⚠️ With no `GEMINI_API_KEY` the copilot is invisible to every customer, and that is by design. A
person who cannot find the buttons is usually looking at a deployment without the key, or a plan
without the flag.

- ⚠️⚠️ **The record reaches the model through [context.ts](src/lib/ai/context.ts) only**, built from
  what the person sees (the timeline, the fields). It is always inside `<record>` and declared to be
  material, not instructions. Emails say who wrote them (`FROM`/`TO the customer`); an internal note
  on a ticket is labelled as one. It must never be passed off as the agent's words, or it ends up in
  a reply.
- ⚠️⚠️ **A draft never carries a figure the model made up without saying so.**
  - The prompt forbids prices, amounts, percentages and dates that are not in the record, and asks
    for `[da completare]` instead.
  - `unsupportedFigures` lists any that slip through, for the person to check before sending.
  - The body comes back as escaped HTML paragraphs (`paragraphsToHtml`).
- A draft is written in the **customer's** language (`documentLanguage`); summaries and briefings in
  the reader's.

**The email dialog** ([send-email-modal.tsx](src/components/crm/send-email-modal.tsx)) is the one
way the CRM writes to a customer: record pages (contacts, leads, companies, deals), documents
(a quote and its follow-up, an invoice's courtesy copy, a payment reminder) and every address shown
on a page — the work queue, orders, a ticket's requester — through
[EmailAddressButton](src/components/crm/email-address-button.tsx).
- ⚠️⚠️ **A new place that sends an email opens this dialog, never a `mailto:` link or a dialog of its
  own.** A `mailto:` email is on nobody's timeline; the old quote and invoice dialogs had no
  templates, no copilot and no copies. `mailto:` stays only for whoever may not write (the plain
  link `EmailAddressButton` falls back to) and for calendar attendees, who have no record.
- **One delivery path**: [email-deliver.ts](src/lib/email-deliver.ts) `deliverEmail` checks copies,
  fills the sender's and deal's fields, sends (the person's mailbox or the workspace), logs on the
  timeline and counts the template. `sendEmailAction`, `sendQuoteEmailAction`, `sendInvoiceCopy` and
  `sendPaymentReminder` all go through it.
- **Document mode** (`document` prop, `EmailDocument`): the address is editable, the text opens on
  what the server writes (`getInvoiceEmailDraftAction`, the quote's texts in the customer's
  language), and the document's own action sends it, because that action also moves the document
  (a quote becomes sent, a reminder is claimed). ⚠️⚠️ The document's parts — the quote's summary
  and link, the invoice PDF — are added by the server (`finish`, attachments) after the text, so no
  version of the text can leave without them; the dialog only names them. And the server still
  decides: a paid invoice is not chased whatever the text says. A document's draft is kept only once
  the person changed the text, so a reminder reopened tomorrow says tomorrow's figures.
- **Preview** shows what the customer receives: the recipient's fields filled in the dialog, the
  sender's and the deal's and the document's parts by `composeEmail` — the function `deliverEmail`
  sends with (`previewEmailAction`, `previewQuoteEmailAction`, `previewInvoiceEmailAction`), so it
  is not a copy that can drift. ⚠️ It is drawn unsanitised, to keep a designed template's `<style>`,
  inside an `<iframe sandbox>` with no scripts and no same-origin; never outside one.
- Invoices go out **from the workspace** (`sender: "workspace"`, reply to the issuer's address), with
  the PDF; a connected mailbox cannot carry the attachment.
- Opened by the page (`open`/`onOpenChange`, `trigger={null}`) or by its own button. Templates and
  the copilot's entry are fetched on the first opening when the page did not pass them
  (`getComposerTemplates`, `getDraftAiEntryAction`); `ai={null}` means hidden.
- The copilot drafts to a company too (`draftEmailAction` takes `company`).
- **Layout**: recipient chip, Cc/Bcc, subject; a tools bar with *Write with AI* and the templates;
  the text editor in its `email` variant (`RichTextEditor variant="email"`: no headings or
  alignment, fields in one menu).
- **Designed templates** (tables, styles) are edited in their preview or as HTML, because the text
  editor would flatten them (`isDesignedHtml`).
- **Drafts** are kept in `localStorage` per record as they are typed, and restored on reopen, with
  the copilot draft's id so its outcome is still recorded. Only *Discard* throws a draft away.
- **Ctrl/Cmd+Enter** sends.
- ⚠️ `sendEmailAction` **returns** its failures (`{ success: false, error }`), translated, instead of
  throwing: a thrown message never reaches the screen in production.
- ⚠️ Cc and Bcc go through `parseAddressList` ([email-addresses.ts](src/lib/email-addresses.ts)) on
  both sides, and a wrong address refuses the send.
- ⚠️ **Bcc is refused from a connected mailbox**, which cannot send it. Sending from the workspace
  instead would switch the sender silently.

**Email templates** ([src/lib/email-templates.ts](src/lib/email-templates.ts), migration `0070`). One
table, two kinds:
- **`campaign`**: made in Marketing (often in the designer), used by campaigns, sequences and
  automations; `getEmailTemplates` returns only these.
- **`personal`**: the text a one-to-one email starts from. Managed at Settings → Email templates
  (also in the menu, under Customers) by anybody with `record:write`, **without the marketing
  module**. Private to its owner until shared. The owner may change it; an administrator
  (`record:manageAny`) may change a shared one (`canEditTemplate`).

The dialog's picker (`getComposerTemplates`) offers mine, then the team's (most used first), then
the campaign ones. It also has *Save as template*. A template's fields (`{{nome}}`) stay fields
until the email is sent, and sending counts the template's use (`use_count`).

- ⚠️ **Global search shows campaign templates only**: it does not know who is searching, and a
  personal template may be private.
- ⚠️ The rules a client component needs are in `email-template-rules.ts`. `email-templates.ts`
  carries the schema, which must not reach the browser bundle.

**Fields fill in two places** ([email-placeholders.ts](src/lib/email-placeholders.ts); each field has a `scope`):
- **The dialog** fills the **recipient's** fields.
- **`deliverEmail`** fills the **sender's** (`{{mittente}}`, `{{mittente_email}}`,
  `{{azienda_mittente}}`, the last from `sellerIdentity`) and, from a deal's page, the **deal's**
  (`{{trattativa}}`, `{{valore}}`, in the deal's currency and the customer's language).
- ⚠️⚠️ So `renderPlaceholders` leaves a field it was **not given** as written, and blanks only one
  given empty. Blanking both would send every email unsigned.
- The campaign editors offer only recipient fields, the unsubscribe link and the letterhead and
  signature (scope `brand`, filled by every sender): a campaign has no sender or deal to fill the others with.

**Parts to write by hand**, in square brackets (`[numero fattura]`), are asked about before sending
(`pendingFields`). So are a deal's field outside a deal and a field nobody knows.

⚠️⚠️ **What the document knows is never left to the person.** A quote's or an invoice's dialog fills
the **document's** fields (scope `document`: `{{numero_preventivo}}`, `{{numero_fattura}}`,
`{{importo}}`, `{{scadenza}}`, `{{iban}}`) from `documentValues`, handed over by `EmailDocument.load`
on every opening — a restored draft too, so a reminder says today's figures. The same values fill the
brackets the basic templates leave (`markers`: "[numero preventivo]", "[importo]", "[data di
scadenza]", in both languages), including in templates already saved in a workspace. A bracket with no
value (a quote with no expiry) stays, and the dialog asks. A reminder's amount and date are what is
overdue, never the invoice total.

**The basic templates** ([email-template-starters.ts](src/lib/email-template-starters.ts), texts in
`emailTemplates.starters`): 25 of them, covering first contact, follow-ups, meetings, quotes, deals
won and lost, orders, contracts, invoices and payments, support, reviews and reactivation.
- Signed with the sender's fields.
- ⚠️ What a record knows is written as its field, filled by the dialog opened from that record
  (`documentValues`, handed as `EmailDocument.load` or the `fields` prop): quote and invoice
  (`{{numero_preventivo}}`, `{{numero_fattura}}`, `{{importo}}`, `{{scadenza}}`, `{{iban}}`), order
  (`{{numero_ordine}}`, `{{data_consegna}}`, `{{corriere}}`, `{{codice_tracciamento}}`, from the
  contact's address on the order page — the last three are the order's Shipping card, migration
  `0071_on_its_way`, `setOrderShipping`), contract
  (`{{riferimento_contratto}}` = its title, `{{fine_contratto}}` = the current term's end, from the
  contract's Email action), ticket (`{{oggetto_richiesta}}`, from the requester's address). Only what the
  CRM does not store stays in brackets: meeting times, a signing deadline, what the person decides. Templates created before this keep their brackets, which the same values fill
  (`markers`).
- "Add basic templates" adds only the missing ones, by name.
- ⚠️ A new starter needs its text in both languages and only known fields:
  `email-template-starters.test.ts` renders every one.

`src/lib/ai/*.test.ts` (recorded answers, PGlite); `scripts/mutations/ai-provider.json`, `ai-access.json`,
`ai-copilot.json`.

### Emails to customers carry the workspace's identity

[src/lib/email-brand.ts](src/lib/email-brand.ts) draws what every email to a customer looks like;
[src/lib/email-brand-load.ts](src/lib/email-brand-load.ts) reads it. Three pieces:

- **The frame** (`brandFrame`): a bar in the brand colour, the logo and what the email is
  ("Preventivo 2026/014"), a hidden preheader, the company's details underneath. Quotes, invoice
  copies, payment reminders, appointment invitations and ticket replies go out in it.
- **The signature** (`signatureHtml`), `full` or `compact`: the person's name, role and phones from
  their Profile (`workspace_setting` `signature.<userId>`), and the workspace's logo, address,
  VAT number, website and socials. Added by `composeEmail` to every email written from the CRM —
  also from a connected Gmail/Outlook mailbox (decided 1 October 2026: Flux's signature, not the
  mailbox's) — and taken off a single message with the dialog's "Firma" button.
- **The boxes** before the text: `summaryBox` (the total, the installments; amber for a reminder),
  `ctaButton`, `ibanBox`.

Brand colour, website and socials are `workspace_setting` `brand.identity` (Settings → General),
next to `brand.logo`. No migration: everything is a setting.

- ⚠️⚠️ **Everything a person typed is escaped; every link is http(s); every colour is a hex.** A
  job title or a company name reaches a customer's inbox inside HTML. `cleanUrl` refuses
  `javascript://host/…` by its scheme — a host does not make it a web address.
- ⚠️⚠️ **The logo has a public address, signed for one workspace**:
  `/api/brand/logo/<token>?v=` ([src/lib/brand-logo-token.ts](src/lib/brand-logo-token.ts)). A
  mail client fetches images with no session. The token signs `brand-logo:<tenant>` with
  `AUTH_SECRET` — the purpose is part of what is signed, so a calendar feed token is never a logo
  token — and opens that workspace's logo and nothing else. `?v=` changes with the logo. Without a
  logo, an app URL or `AUTH_SECRET`, the company's name is drawn as a wordmark instead.
- ⚠️ A light brand colour gets dark text on its buttons (`inkOn`, WCAG 3:1), and is not used as text.
- ⚠️⚠️ **A template that places `{{firma}}` gets the signature there, and not again at the end**
  (`placesSignature`). `{{intestazione}}` and `{{firma}}` are the builder's "Letterhead" and
  "Signature" blocks (placeholder scope `brand`), filled by every sender: `composeEmail`, campaigns
  (the sender's signature, the campaign owner's when the scheduler sends), sequences (the
  enrollment owner's: full on the first email, compact on a reply in the thread) and rules (the
  record owner's).
- ⚠️ An invoice's copy carries **no** personal signature — it comes from the business — and a
  credit note no IBAN. A reminder carries the sender's compact signature.
- ⚠️ **Each recipient reads it in their language.** Appointment invitations follow the invited
  contact's company (`documentLanguage`); a colleague or a typed address reads Italian. They were
  Italian for everybody, and the ticket reply had an English line for everybody.

`src/lib/email-brand.test.ts`, `src/lib/email-brand-compose.test.ts` (PGlite),
`src/lib/brand-logo-token.test.ts`; `scripts/mutations/email-brand.json`.

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

⚠️⚠️ **The bundle is 9.06 MB gzipped against a 10 MB limit** (measured on 1 October 2026
with `npx wrangler deploy --dry-run`: 9,276 KiB of 10,240; 9,149 on 30 September, before the
branded emails and the work beside them). It fits Workers Paid, never
Free (3 MB). ⚠️⚠️ **Next bundles per route, so an import is paid once per route that reaches
it.** The SDI integration first took it to 9,977 KiB — 263 KiB from the limit — because the
settings page and the job imported the sending module, which imported the invoice archive, which
imports the PDF library: one more copy of pdf-lib per route. Loading the archive only where a file
is built (`await import(...)` in `sendToSdi`) took it to 8,968. Before importing a heavy module
into something many routes use, measure. It used to
be written here as "~8 MB", which is how nobody noticed it growing. Measure it with the
dry run before adding a library, and after a dependency update: the September update
took it *down* by 154 KiB, which is the direction to keep.

What does **not** work on Workers, because there is no filesystem and no long-lived
process:

- ~~Scheduled automation rules do not run anywhere.~~ The node-cron scheduler is gone;
  rules with the `onSchedule` trigger run every morning inside `task-overdue-check`
  ([src/lib/scheduled-rules.ts](src/lib/scheduled-rules.ts)): once a week per rule and
  record at most, read from the rule's own log, and at most `SCHEDULE_MAX_RUNS` per
  workspace per run. The old `scheduled:<cron>` triggers are still not run, and the
  builder says so.
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

⚠️⚠️ **Installed is not enough: it must also be traced whole.** Next copies into
`.open-next` only the files its tracer resolves, under Node's conditions — and there
`pg-cloudflare` exports `dist/empty.js`. The Worker bundle resolves it under `workerd`, to
`dist/index.js`, which was not there: the same error, with "The module ./dist/index.js
was not found on the file system", on 27 September 2026. `outputFileTracingIncludes` in
[next.config.mjs](next.config.mjs) copies the whole package.

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

### On Workers the database is reached through Hyperdrive

⚠️⚠️ **A Worker cannot open a TLS connection to a Postgres like Railway's.** Tried on
the real runtime, twice: plaintext connects, TLS dies with "Connection terminated
unexpectedly". So on Workers every connection goes through a **Hyperdrive** binding,
which holds the pool and terminates the TLS itself, verifying Railway's self-signed
certificate against a CA uploaded to the account (`wrangler cert upload`,
`sslmode=verify-ca`). Query caching is off: a CRM that serves rows a minute old
without saying so is worse than a slow one.

One binding per database. The registry's is named `HYPERDRIVE_PLATFORM`; a workspace's
is named after its database (`flux_demo` → `HYPERDRIVE_FLUX_DEMO`). Adding a workspace
therefore needs `wrangler hyperdrive create` **and a deploy** — bindings are static.
That is the cost of this arrangement, and the reason it is a stop on the way rather
than a destination: an app beside its database (Railway, Vercel, a container) needs
none of it.

Three ways this failed silently, all of them fixed in [src/db/index.ts](src/db/index.ts):

- **The binding name did not match.** The lookup derived `HYPERDRIVE_RAILWAY` from the
  database name while the binding was `HYPERDRIVE_PLATFORM`, found nothing, and fell
  back to the direct connection — which a Worker cannot make. A name is passed in now,
  and the derived one is only a fallback.
- **`require` inside the Worker.** The context was loaded with `require(...)` in a
  function; the bundle is ESM, the call threw on every request, and the surrounding
  `catch` turned that into "no Hyperdrive here". It is a static import.
- **A pool reused between requests.** The socket closes with the invocation, so the
  next request got a dead one: "Connection terminated unexpectedly" again, while a
  hand-written `Client` in the same Worker worked. The instance is keyed to the request
  (a `WeakMap` on the execution context) on Workers, and to the connection string
  everywhere else.

⚠️⚠️ **The pool's size is how many queries of a request run at once.** It was one, so every
`Promise.all` on the dashboard queued on a single socket and the home page waited for about
thirty round trips in a row (27 September 2026: ~1 s of a 1.1–1.5 s response, 150–450 ms of
it CPU). It is 2 for the registry and 3 for a workspace — five of the **six** connections a
Worker invocation may hold, sockets and `fetch()` together; the seventh waits until one
closes, so an idle socket is closed after a second. Raise either and the sum must stay under
six.

⚠️⚠️ **Every Hyperdrive binding carries a placeholder `localConnectionString`** in
wrangler.jsonc. Wrangler refuses to start its local emulator for a binding with no local
database, and `opennextjs-cloudflare deploy` — which a plain `wrangler deploy` re-dispatches
to — starts one just to read the Worker's variables. On Workers Builds there is no
`.dev.vars`, so every deploy failed with "no local hyperdrive connection string" (27 September
2026). The placeholder is never uploaded and never a real credential; a new binding needs one.
To emulate against a real database, set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_<BINDING>`
in `.dev.vars` (not committed), which takes precedence.

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

⚠️⚠️ **A migration, once embedded, is never edited — the next change is a new one.** A dev
server started from this machine talks to the production databases (`.env` points at Railway)
and migrates them the moment `npm run generate:migrations` rewrites the embedded file; the
migration is recorded by its timestamp, and a recorded one is never read again. On 29
September 2026 two columns added to `0065` after it had run were never created, and every
invoice page failed on them in development and in production alike (`0066` carries them).

`src/db/migrations-rerun.test.ts` holds that line: it applies every embedded
migration to a real Postgres (PGlite, in-process) and then runs each one a second
time. `0002_odd_ulik` predates the rule and is the one named exception.

`npm test` fails when the generated file and the folder disagree, because shipping code
whose columns were never created is exactly the failure that looks like a working deploy.

### The calendar

`/dashboard/calendar`: month, week, day and list views; appointments created,
edited, duplicated, cancelled, restored and deleted from a detail panel; moved by
dragging and stretched from their lower edge (mouse and pen only — a finger is
scrolling). On a phone the day view carries a sticky week strip (a dot per busy
day; a tap picks the day), a sideways swipe walks days, weeks or months
([swipe-nav.tsx](src/app/(main)/dashboard/calendar/_components/swipe-nav.tsx) — never
taken from a vertical scroll or from anything that scrolls sideways itself), and
the week is read as a list day by day instead of seven 116px columns. The day itself is a
**list** on a phone — all-day first, then in order, free hours named, a "now" line today —
and the hour grid from md up; "List | Grid" switches and is remembered per browser
([calendar-day-layout.ts](src/lib/calendar-day-layout.ts)). ⚠️ The grid at 64px an hour is
~960px whatever the day holds: two meetings were a screen and a half of scrolling.
Actions in [src/actions/appointments.ts](src/actions/appointments.ts),
migration `0029_the_reminder_rings_once` and `0030_again_and_all_day`.

⚠️⚠️ **Every time is on the workspace's clock** — the business calendar's zone
(`getWorkspaceTimeZone`, set in Settings → General), never the server's and never the browser's. On Workers
the server is UTC, and laying a day out with `getHours()` drew a ten o'clock meeting
at eight. The page shifts instants with `wallClock()` for layout only and hands the
real instants to the client; the form, the drag and the availability grid exchange
wall-clock strings and convert them with [src/lib/wall-clock.ts](src/lib/wall-clock.ts).
A shifted Date must never reach the browser or the database.

⚠️⚠️ **A repeating appointment is one row with an RFC 5545 RRULE**, expanded on read
by [src/lib/recurrence.ts](src/lib/recurrence.ts) on the series' own wall clock (so
ten o'clock stays ten across summer time). The subset it supports is listed at the
top of that file; anything else parses to null and is refused on save. Invitations
and the feed carry the rule with `TZID` and a generated `VTIMEZONE` — a UTC rule is
expanded in UTC by every client and drifts an hour for half the year.

- An occurrence is named by its start (`?occurrence=` ISO); removed ones are
  `recurrence_exceptions` (EXDATE), and COUNT counts them, as the RFC does.
- "This event" adds an exception and creates a detached copy
  (`recurrence_parent_id`); "this and following" ends the series (COUNT recomputed,
  or UNTIL a second earlier) and starts a new one; "all" moves the series, and its
  exceptions, by as much as the edited occurrence moved.
- Deleting or cancelling a series takes its detached copies with it.

⚠️ **All day** is midnight to midnight *after* the last day, in the zone — iCalendar's
exclusive DATE end. Durations dragged or copied are measured on the wall clock: a day
across the change of hour is 23 or 25 real hours and must still end at midnight.

⚠️ **Reminders** go out from `task-reminders` ([src/lib/appointment-reminders.ts](src/lib/appointment-reminders.ts))
to the organiser and invited colleagues who have not declined. `reminder_sent_for`
is the occurrence the reminder rang for, set by the update that claims it: a moved
appointment and the next occurrence of a series no longer match, and ring again with
nothing to reset. `src/lib/appointment-reminders.test.ts` and
`src/actions/appointments.test.ts` run both against PGlite.

⚠️ **Whose calendar is one URL value**: `filter=all|mine|group|u:<id>,<id>`
([src/lib/calendar-filter.ts](src/lib/calendar-filter.ts)), so every link the page builds
carries it. The ids are only cleaned: the filter picks among the events a person may see
anyway ("Who sees which customer", below). With two people or more, each event's left edge takes the
colour of the first chosen person involved in it (`people` on every event: owner and
assignee, organiser and invited colleagues), and a key names them.

### The home: one dashboard per kind of work

`/dashboard/crm` opens on the dashboard the person chose at Profile → My dashboard
(`user_preference.home_dashboard`, migration `0058_what_opens_first`), else the one for
their role: sales, salesManager, admin, support, direction
([src/lib/home-dashboards.ts](src/lib/home-dashboards.ts)). `?dashboard=` opens another for
the visit; the old `?view=me|company` still maps to sales/direction.

- ⚠️⚠️ **Each dashboard reads only its own figures.** The three newer ones return before
  the personal and company reads ([src/lib/home-dashboard-data.ts](src/lib/home-dashboard-data.ts)).
  Reading everything and showing a part is how the home cost thirty statements a visit.
- ⚠️ Who may open which is decided in one place (`availableDashboards`), and a saved or
  linked dashboard the person can no longer open falls back to the default. Administration
  (money) needs `settings:manage` and the sales module.
- Every figure links to the list it counts, and money from invoices stays in its currency.
- ⚠️ The money dashboard opens with won this month, won ever, **collected** and **invoiced**
  (`moneyHeadline`). Collected counts every recorded payment, including one on an order with
  no invoice. Invoiced is the *taxable* amount of *issued* invoices, and a credit note
  (TD04) subtracts. A draft is not revenue. `scripts/mutations/home-dashboards.json` breaks
  each rule.

### Themes

A theme is one CSS file in [src/styles/presets/](src/styles/presets/) (light and dark
blocks of the design tokens), imported by `globals.css` and listed for the picker by
`npm run generate:presets`. Its name is translated under `layoutControls.presets`.

⚠️⚠️ **A theme is checked for contrast, not by eye.** [src/lib/theme-contrast.ts](src/lib/theme-contrast.ts)
turns every text/background pair that matters — the muted label grey used ~1,600
times, primary as link text, the primary button label, errors, the sidebar — into a
WCAG 2.1 ratio, and `src/styles/presets.test.ts` holds every theme the picker
offers to AA in both modes (a new one fails the test until it is listed and passes).

⚠️ In a dark mode the primary cannot carry white text *and* read as text: a colour
dark enough for one is too dark for the other on a dark page (the default theme had
links at 2.2:1 until 26 September 2026). So dark primaries are light, with dark text
on them.

The picker is in the layout panel from md up, and in the Menu hub on a phone
([mobile-theme-picker.tsx](src/app/(main)/dashboard/_components/sidebar/mobile-theme-picker.tsx)),
both through the same apply–store–persist steps.

### Completing a task records it

A task has a kind — `call`, `email`, `meeting`, `todo` ([src/lib/task-kinds.ts](src/lib/task-kinds.ts),
migration `0034_how_did_it_go`) — and ticking one opens "How did it go?"
([task-outcome-dialog.tsx](src/components/crm/task-outcome-dialog.tsx)): outcome, note, next step.
`updateTaskStatus(id, "done", path, report)` writes the activity of that kind with the outcome
and `task_id`, owned by whoever completed it, and creates the next task on the same record.

⚠️ A new place that completes a single task should open that dialog, not call
`updateTaskStatus` directly: a bare tick records a call with no outcome and plans nothing,
which is the three-records-per-call habit this replaced. Bulk completion is the exception.

⚠️ **Idle days and "next step" on a deal are computed on read**
([src/lib/deal-signals.ts](src/lib/deal-signals.ts)), for the board, the deal page and the
work list alike. `deal.health_score` is dead — written only right after an edit, so it could
never go stale-red — and stays in the schema only because tenant migrations are additive.

### Automation emails go through the workspace's queue

A rule's `send_email` ([email-service.ts](src/components/crm/automation/email-service.ts))
queues an `email_job` — with `cc`/`bcc`, migration `0038_copied_in` — signed against a
campaign log for tracking and unsubscribe; the worker sends it with the workspace's own
configuration. ⚠️ It used to call Resend with the global key from `automation@fluxcrm.app`,
past the exclusion list: a customer who had unsubscribed still got the rule's emails. A
suppressed recipient is skipped, not an error.

### One morning email, not one per task

`task-reminders` notifies (bell and push) per task due today but sends **no email per
task**; the tasks reach the inbox once, in the digest `task-overdue-check` sends each
morning ([src/lib/morning-digest.ts](src/lib/morning-digest.ts), migration
`0037_good_morning`): due today, late, deals with nothing planned, replies owed, accepted
quotes. Members only, `digest_email` switchable in My notifications, written in the
`locale` remembered from the home page, and claimed per day with a conditional update so
two runs send one email. ⚠️ Built from a few grouped queries per workspace, never the full
work list per person: the job runs every workspace in one request.

### Speed: what a page switch costs

Every query is a round trip through Hyperdrive (tens of ms) on a pool of three, so a page is as fast
as its longest chain of awaits. Audit of 1 October 2026; the rules it left:

- ⚠️⚠️ **`auth()` is read once per request** (`cache()` in [src/auth.ts](src/auth.ts)): a page used to
  call it five to ten times, and once the role check was five minutes old each call queried the
  registry. The role read is remembered per isolate for those five minutes (`recentMembership`).
- ⚠️⚠️ **Per-request lookups go through React `cache()`**: `getTenantById`, `getEntitlements`,
  `getTenantEntitlements`, `readWorkspaceFeatures`. ⚠️ **Never a promise shared between requests**:
  on Workers a request awaiting I/O another request started can hang. Isolate maps keep values.
- **Start independent reads together** and await them where used: the record pages start the
  copilot's entry, the plan, the timeline summary and every list before the record row arrives.
- **A slow card gets its own `<Suspense>`**: `RecordTimeline` has one inside it, so the record draws
  before its history; its own queries run side by side.
- **Every section and every record page has a `loading.tsx`** from
  [page-skeletons.tsx](src/components/crm/page-skeletons.tsx) (list, record, board, calendar). A new
  section adds one.
- ⚠️⚠️ **Navigation links are `IntentLink`** ([intent-link.tsx](src/components/intent-link.tsx)):
  prefetch on hover, touch or focus, so the skeleton is there at the tap. Not `prefetch={false}`
  (every tap a cold trip, the old page frozen), not viewport prefetch on forty sidebar links. A
  `LinkPending` dot and the top `NavigationProgress` bar answer every tap at once.
- `experimental.staleTimes.dynamic: 30` in next.config.mjs: a page seen in the last 30 seconds is
  shown again at once; a save still invalidates it.
- **Data a dialog needs is loaded when it opens**, never with the page: the deal dialog's companies
  and contacts (every row of both tables used to travel with each board and deal visit), the email
  composer's templates. **A row's edit dialog is mounted at the first press** (contacts, leads).
- **Heavy client code is `next/dynamic`**: the email editor (Tiptap) loads when the composer opens.
- **No redirect to apply a default**: the board applies `owners=<me>` itself and writes it into the
  address with `history.replaceState` (two server renders per tap before).
- The service worker uses navigation preload: a cold installed app no longer waits for the worker
  to wake before asking for the page.
- ⚠️⚠️ **No `router.refresh()` after an action that revalidates the page being viewed.** The action's
  response already carries the page re-rendered ("updates the UI immediately, if viewing the
  affected path"); a refresh after it rendered everything a second time, layout included. 73 of 103
  were removed on 1 October 2026. A refresh stays only where the action does **not** cover the
  page: a literal list path (`/dashboard/leads`) does not cover `/dashboard/leads/123`, so the
  record pages' stage bars, the deal edit button and the merge dialog keep theirs; so do a change of
  session, an `/api` fetch, and a refresh that also runs when the action failed (to undo an
  optimistic change).
- **The home streams its work list and first-run card** (`HomeNextActions`, `HomeOnboarding` in
  their own `<Suspense>`): nine of its ~20 statements no longer hold back the greeting, the figures
  and the agenda.
- **Charts load after the page** (`*-lazy.tsx` beside forecast, pipeline report and cash flow).
  ⚠️ A module that renders a chart must not export anything else a page imports: `CashError` lived
  in cash-card.tsx and put Recharts into every company page (it is `cash-error.tsx` now).
- A ticket's linked tasks and people arrive with the page; its presence is one request every 30
  seconds and none from a hidden tab. ⚠️ Presence is kept in one isolate's memory, so on Workers it
  is a hint, not a fact: making it reliable needs shared state (a Durable Object), not the database
  every 15 seconds.
- ⚠️ **The message catalog is not split** (decided 1 October 2026): 89 of its 93 namespaces are read by
  Client Components, so `pick` would save 4%; a real cut means a catalog per section, 573 files. It
  travels with full loads and refreshes, compressed, which is why removing refreshes mattered.

### A lead assigned is a lead somebody is told about

[src/lib/lead-assignment.ts](src/lib/lead-assignment.ts): the new owner, or — handed to a group — every
member of the group, hears of it (`lead_assigned`, which pushes); whoever made the assignment does not.
⚠️⚠️ Every way a lead gets an owner or a group goes through it: `createLead` and `updateLead`, the bulk
reassignment (one notification with how many), the single `POST /api/crm/leads` (a key is a machine:
the owner is told even when the key's person is the owner), web forms, the automation's round-robin.
A lead created already assigned used to tell nobody, and one handed to a group told nobody at all. It
writes into the database it is handed (`notifyManyIn`): on the API there is no session and `notify`
reads one. The bulk import routes and the CSV import tell nobody, like they run no rules.
`src/lib/lead-assignment.test.ts` (PGlite); `scripts/mutations/lead-assignment.json`.

### From a lead to a won deal (tappa 1 of docs/processo-operativo-2026-10.md)

**Where a customer came from is one list** ([src/lib/record-sources.ts](src/lib/record-sources.ts),
table `record_source`, migration `0073_where_they_came_from`), managed at Settings → Lists.
- ⚠️⚠️ **A record stores the source's key, never its label.** A built-in source has `name` null and is
  read as `common.sources.<key>` in the reader's language; renaming one moves no record and splits no
  report. Retired, never deleted. Merging (`mergeRecordSourceAction`) moves lead, contact, company,
  deal and order in one transaction; a value on records that nobody listed is shown there to list
  or merge.
- The deal carries `source` too, copied from its lead on conversion: "won by source" on the funnel
  and the report builder read it.
- Forms use `SourceSelect` ([source-select.tsx](src/components/crm/source-select.tsx)), filters get the
  list as `lookupOptions` (`sourceFilterOptions`), server pages and reports label with `sourceLabeller`.
  ⚠️ A form shows the record's own source even when it is retired or unlisted (`sourceChoices`):
  opening and saving must never erase it.

**The work queue** ([src/actions/next-actions.ts](src/actions/next-actions.ts)) also lists:
- `call_due`: call tasks due today (on the workspace's clock) or late up to 30 days, for whoever is
  assigned, or the owner when nobody is. Completed from the row as a call (`taskType`).
- `lead_new`: a lead in status `new` nobody has spoken to (a call, email or meeting — a note does
  not count), younger than `leadUntouchedDays`, the person's own, their group's or nobody's. Older,
  it is the owner's `lead_untouched`. ⚠️ One row per lead: a call planned on it stands for it.

**Converting a lead** (`convertLead(id, createDeal, { pipelineId, privateCustomer })`, the dialog
[convert-lead-dialog.tsx](src/components/crm/convert-lead-dialog.tsx), shared by the lead page and
the list): the deal opens in the chosen pipeline's first *open* stage with its probability; owner and
group are the lead's (the converter's when it had none); the source, appointments, documents and
custom fields (same slug *and* kind) move with it; the rules run (deal `onCreate`, lead `onUpdate`).
- ⚠️⚠️ **A private customer is a company in their own name** (`privateCustomer`, on by default for a
  lead with no company): a quote requires a company and an invoice is made out to one. Never matched
  by name; a person who is a contact already keeps their company.
- ⚠️⚠️ **A person is named, not denominated.** The private customer's company carries
  `person_first_name` / `person_last_name` (migration `0074_a_person_not_a_company`, the billing tab,
  filled by the conversion); with both, `customerSnapshot` freezes them and the FatturaPA buyer is
  `<Nome>` + `<Cognome>` instead of `<Denominazione>` (`anagrafica` in `fatturapa/xml.ts`), and Fatture
  in Cloud gets `type: "person"`. One name alone stays a Denominazione. ⚠️ A customer with a personal
  codice fiscale and no partita IVA is not invoiced without both names (`customerGaps`, field
  `personName`): a private customer filed before the columns existed would otherwise be a business.

**The tappa 0 configuration is a script**, `npx tsx scripts/setup-processo-operativo.ts <subdomain>`
([src/lib/workspace-setup/processo-operativo.ts](src/lib/workspace-setup/processo-operativo.ts)): a preview unless
`--applica`. ⚠️⚠️ It creates only what is missing, by name, and adapts only values still exactly as
`seedWorkspace` wrote them (a stage keeps its id); rules are created switched off, priceless products
inactive. A preview that wrote anything, or a run that overwrote a choice, would break the one promise
that makes it safe to run on a live workspace.

**Rules on "won"** fire from `convertQuoteToOrderAction` too (deal `onUpdate`, once, only when this
conversion won it), with the owner's `deal_won` notification and `deal.stage_changed`. A rule's
"create task" resolves `entity_owner` and stores "unassigned" as null: both used to break the
foreign key and fail the rule on every run.

`src/actions/next-actions.test.ts`, `src/actions/record-sources.test.ts`, `src/lib/record-sources.test.ts`,
`src/actions/convert-lead.test.ts`, `src/components/crm/automation/create-task.test.ts`,
`src/actions/pipeline-close.test.ts`; `scripts/mutations/{next-actions,record-sources,lead-conversion,deal-close}.json`.

### A record's timeline

[src/lib/record-timeline.ts](src/lib/record-timeline.ts), drawn by `<RecordTimeline scope=… />`
on the four detail pages: the record's activities and its related records' (company ← its
contacts and deals, contact ← its deals), its field changes and its quotes' events, newest
by when they happened, paged. The tab's count and "last contact" come from
`recordTimelineSummary`, the same source, so they cannot disagree with the list.

⚠️ Every save of a deal, contact, company or lead calls `recordFieldChanges`
([src/lib/field-history.ts](src/lib/field-history.ts), table `field_change`, migration
`0035_who_changed_what`). A new action that updates one of them must too —
`src/lib/field-history.inventory.test.ts` lists the ones that do.

### A customer's email reaches whoever owns them

[src/lib/inbound-sales-reply.ts](src/lib/inbound-sales-reply.ts), called from
`processInboundEmail` before any ticket is opened: an email with no ticket reference, from
a contact (its owner, else its company's) or an unconverted lead with an owner, goes on
that record's timeline and becomes an `email` task "↩ name: subject" for the owner, due
today, with an `email_reply` notification. Everybody else still opens a ticket.

⚠️ A reply to a ticket stays on the ticket whoever sent it, and a reply that stopped a
sequence does not notify a second time.

⚠️ Emails sent from a record carry `Reply-To` = the sender **only when inbound email is
not configured** (`replyToFor`). With it configured the answer must come back to the
workspace address, or it never reaches the record.

### Email written outside Flux: the Bcc archive address

[src/lib/mail-archive.ts](src/lib/mail-archive.ts), migration `0039_kept_in_copy`. Each
person has `crm+<subdomain>.<token>@$INBOUND_BCC_DOMAIN`, shown on `/dashboard/profile`;
an email carrying it is filed on every contact and open lead among its sender, To and Cc
(at most `ARCHIVE_MAX_RECORDS`), and on nothing else — no ticket, no task, no stub contact.
Matching nobody sends a `mailArchiveUnmatched` notification instead of vanishing.

⚠️⚠️ **A Bcc recipient is in no header.** It is found among the *delivery* recipients
(`recipients` in the inbound payload: the bridge's envelope, `Delivered-To`,
`X-Original-To`), which both webhook routes collect. A bridge that passes only the headers
will never see the address, and nothing will say so.

⚠️ The token is the credential. It is not cached, so rotating it retires the old address
at once, and the owner must still hold `record:write` in the registry (`membersWith`) —
an address outlives a membership.

⚠️ `activity.message_id` with a unique index per record is what keeps a redelivered
webhook, or two colleagues copying the same email, from filing it twice: the insert
decides, with `ON CONFLICT DO NOTHING`.

`INBOUND_BCC_DOMAIN` needs an MX that delivers to one of the inbound webhooks; unset (or
with no inbound secret), the profile card says the archive is unavailable.
`src/lib/mail-archive.test.ts`; `scripts/mutations/mail-archive.json`.

### A person's own mailbox: Gmail and Microsoft 365 (V3.2, dormant)

Decision D-B: both providers, behind one shape ([src/lib/mail-providers/](src/lib/mail-providers/)),
**off until they may run**. Connected from the profile page; migration `0052_their_own_mailbox`.

- ⚠️⚠️ **Three states** ([registry.ts](src/lib/mail-providers/registry.ts)): no `MAIL_*_CLIENT_ID/SECRET`
  → off, and the profile says so; credentials without `MAIL_*_VERIFIED=1` → only Flux staff may
  connect (Google keeps an unverified app to test users and expires their grant in a week);
  verified → anybody with `record:write`. The flag is a statement by whoever operates the
  deployment, set when Google's review of the restricted Gmail scopes (or Microsoft's publisher
  verification) has passed. `MAIL_GOOGLE_*` is **not** `AUTH_GOOGLE_*`: sign-in must not wait
  for a mailbox review.
- ⚠️⚠️ **The round trip** ([src/lib/mail-oauth.ts](src/lib/mail-oauth.ts)): a state signed with
  AUTH_SECRET naming workspace, person and provider (ten minutes), a nonce that must match an
  httpOnly cookie, PKCE. The callback also requires the signed-in person and open workspace to
  be the ones that started. Not under a public prefix: the proxy gives it the session's workspace.
- ⚠️⚠️ **Tokens are encrypted with the platform key** and are part of the key rotation
  (`mail_connection.access_token` / `refresh_token` in `scripts/rotate-platform-key.ts`). A
  refresh answered 400/401 marks the connection `revoked` with the reason; Microsoft rotates
  the refresh token, and the new one is kept.
- **Sending** from a record goes out of the person's own mailbox when connected
  ([src/lib/mailbox-send.ts](src/lib/mailbox-send.ts)) and records the provider's Message-ID, so
  the copy read back from Sent is the same timeline entry. ⚠️ A connection that fails fails the
  send — never a silent switch to the workspace's sender.
- ⚠️⚠️ **Reading** runs inside `email-worker` ([src/lib/mail-sync.ts](src/lib/mail-sync.ts)):
  from the moment of connection, never the backlog; filed through `fileArchivedEmail`, so only
  mail with contacts and open leads is kept and the rest is read and forgotten. A reply stops the
  person's sequences. **One budget per run across all workspaces** (`MAIL_SYNC_BUDGET`, 400
  estimated subrequests), longest-unread mailbox first — the Worker's thousand is shared with
  everything else the job does.
- **Busy time** is read every 30 minutes for 45 days ahead as bare intervals (`mail_busy`) and
  counted by `busyByUser`: the booking page and the colleague picker see it.
- **Appointments** the person organises are written to their calendar
  ([src/lib/appointment-mirror.ts](src/lib/appointment-mirror.ts)) after the response, with no
  attendees (Flux sends its own invitation). ⚠️ **Repeating series are not mirrored yet.**
- ⚠️⚠️ **Only people who may still write keep a connection.** Each run asks the registry who
  holds `record:write` and disconnects (revokes and forgets) any other — a departed colleague's
  own mailbox was otherwise read into the old workspace for good. The connect routes refuse a
  read-only member.
- ⚠️⚠️ **Only `invalid_grant` ends a connection.** A wrong client secret answers 400/401 too, and
  revoking on that disconnected every mailbox at once. A passing failure fails the send rather
  than switching to the workspace's sender.
- ⚠️ Budget: reserved before a read, refunded after, and at most `MAIL_SYNC_PER_WORKSPACE` per
  workspace. A reply stops only enrollments made before it was written. Connected again after a
  revocation, a mailbox starts from now. Microsoft needs `Mail.ReadWrite` (a send is a draft
  first); all-day mirrors go in as free. Public bookings are mirrored too.
- ⚠️ **No real mailbox has been through this.** The clients are written against the documented
  APIs and tested with recorded answers; the first verified credentials are the first real test.
  Graph queries are built by hand (`odata()`): URLSearchParams writes a space as "+", which OData
  reads as a plus.

`src/lib/mail-oauth.test.ts`, `src/lib/mail-providers/providers.test.ts`,
`src/lib/mail-sync.test.ts` (PGlite), `src/app/api/mail/callback/[provider]/route.test.ts`;
`scripts/mutations/mailbox.json`.

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

A step is an email **or a task** for the enrollment's owner (a call, a LinkedIn
message), created due that day on the record; a sequence can count **working days**
and send only inside a **window** of hours — both on the workspace's clock, read by
the runner from the database it was handed (migration `0045_one_conversation`).

⚠️⚠️ **A reply in the thread is one conversation, not five emails.** The first
email carries a `Message-ID` we choose (`<seq-{enrollment}@{app host}>`), stored on
the enrollment with its subject *in the same update that claims the step*, so the
id a later reply answers is the one that went out. A step marked `replyInThread`
goes out as `Re: <first subject>` with `In-Reply-To`/`References` set to it; only
an email with an earlier email can be one, and it needs no subject of its own.

⚠️ Whether Resend keeps a caller-supplied `Message-ID` is **unverified**: its docs
show `In-Reply-To` and `References`, not this. Check the headers of the first
email of a real sequence. If Resend rewrites it, clients that thread on headers
(Apple Mail, Thunderbird) will not join the replies; Gmail still groups them by
the `Re:` subject. SMTP (nodemailer) sets it as given.

⚠️ An automatic reply (out of office) counts as a reply and stops the sequence.
That is the safe direction to be wrong in; telling the two apart needs headers
the inbound payload does not carry today.

### Support: promises, and the customer's side of them

Every ticket carries its SLA however it was born — typed in, by email, from the web
form, or opened by a reply to a closed one — through `resolveSla(db, …)` in
[src/lib/ticket-sla.ts](src/lib/ticket-sla.ts). ⚠️⚠️ It used to read the workspace
from the request, so the tickets arriving by email and from the site (most of them)
had no deadline at all, and nothing measured against one could be true.

⚠️⚠️ **One status rule**: `statusStamps` in
[src/lib/ticket-state-machine.ts](src/lib/ticket-state-machine.ts). The board's drag
calls `updateTicketAction`, not a copy of it — the copy skipped the owner check, the
rules and the resolution email. Reopening clears `resolvedAt`; a customer's email
reopens a resolved ticket, because the resolution email promises it will.

A late first answer is stamped (`firstResponseBreachedAt`) when it is given, and by
`ticket-sla-check` while it is still not given. Nothing wrote that column before.

**The customer's side** ([src/lib/ticket-public.ts](src/lib/ticket-public.ts),
migration `0046_how_did_we_do`): a status page at `/t/<workspace>/<token>` and, when
the workspace switches it on (SLA page), an email on resolution asking with one click
how it went.

- ⚠️⚠️ The token is the whole of the customer's access, so the page shows **public
  messages only**, sanitised. An internal note is a colleague talking about them — and the
  ticket's description is shown only when the customer wrote it (`email`, `web`): typed in
  by an agent from a call, it is the agent's summary.
- ⚠️⚠️ Asked **once**: `csat_requested_at` is set by a conditional update and only the
  caller that set it queues the email. Off by default — it writes to customers.
- ⚠️⚠️ The email's buttons open the page with `?rate=`, which only **highlights** the answer:
  a person presses it. A GET that voted would be voted by every mail scanner — and a page
  that posted on load was voted by the ones that run scripts, both buttons, each flip a
  notification.
- A bad answer notifies whoever handled the ticket (`ticket_rated_bad`), once.
- Texts are in the customer's language ([src/lib/ticket-public-text.ts](src/lib/ticket-public-text.ts)),
  like a quote's.

`/dashboard/support/agents` is the desk by person; what each figure counts is at the
top of [src/lib/support-metrics.ts](src/lib/support-metrics.ts).

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

#### What customers still owe

[src/lib/receivables.ts](src/lib/receivables.ts), migration `0053_what_came_in` (I9): a payment
row (`order_payment`, the same table) may name the **invoice** it settles, and the order is now
optional on it. Finance shows the receivables schedule — issued invoices still owed something,
by age, most overdue first — and each invoice page records its payments.

- ⚠️⚠️ **Owed = total − credit notes − payments that name it**, through `paymentSummary`, the
  arithmetic an order uses. Only an issued TD01 or TD02 is a receivable (`RECEIVABLE_TYPES`); a
  credit note is money going the other way. No due date means due on issue.
- ⚠️⚠️ **A payment on an order reaches its invoice when there is no doubt which**: the order's only
  issued invoice, or — with several — the one the person chooses; `recordOrderPayment` refuses
  to guess (I10). With none it is a deposit on the order, and issuing the order's only invoice
  links it (`linkOrderPayments`). A deposit left on an order that now has invoices is linked from
  its row (`linkAllocation`).
- ⚠️⚠️ **Deleting an order keeps what was paid on its invoices** (detached, `order_id` null):
  the cascade used to take it, and a paid invoice went back to overdue.
- ⚠️ An amount is read once, strictly (`parsePaymentAmount`): `parseFloat` read "12abc" as 12
  and the insert stored NaN, which a numeric column accepts and every sum then repeats.
- ⚠️ Totals are per currency; ages are whole days on the workspace's clock.
- `invoice.paid` goes out when an invoice becomes settled: by a payment, by deposits linked at
  issue, or by a credit note bringing what is due down to what was paid. Two landing together
  can both send it — at-least-once, like every webhook.
- ⚠️ The Finance card imports `receivables-aging.ts`, never `receivables.ts`, which carries the
  schema into the client bundle.

`src/lib/receivables.test.ts`, `src/actions/order-invoice-payment.test.ts`;
`scripts/mutations/receivables.json`.

#### Money that arrived, and where it went

[src/lib/receipts.ts](src/lib/receipts.ts), migration `0059_what_arrived_and_where_it_went` (I10,
roadmap Fase 4). A **receipt** (`receipt`) is what reached the account: day, amount, currency,
the bank's reference, the customer. Its **allocations** — the `order_payment` rows, which name
their receipt — say which invoices or orders it paid. What is left unallocated is the
customer's **credit**; a negative receipt is a **refund**.

- ⚠️⚠️ **"Collected" reads receipts, by the day they arrived** (cash); what an invoice owes reads
  the allocations that name it. One transfer can pay several invoices of one customer, in one
  currency (`recordReceipt`), and a later invoice spends credit in one click (`allocateCredit`).
- ⚠️⚠️ **An allocation never exceeds its receipt, and the database decides.** Spending credit
  locks the receipt's row, inserts, then checks the sum inside the same transaction — a
  division by a row-dependent zero fails it. ⚠️ A constant `1 / 0` in a CASE is folded while
  the query is planned and fails every time; a stored "allocated" figure would drift from the
  rows the first time a cascade deleted one.
- ⚠️ Correlated subqueries name their outer column in full (`"receipt"."id"`): in a select list
  Drizzle writes a column without its table, and `p.receipt_id = "id"` compared the allocation
  with its own id — every sum was zero.
- ⚠️ Taking a payment back deletes its receipt when it was all of it and did not come from the
  bank, otherwise only the share, which returns to credit (`removeAllocation`). From an order's page it asks for
  `invoice:write` when the payment paid an invoice. Deleting an order leaves its deposits as
  the customer's credit: money that arrived does not disappear with a document.
- ⚠️ A payment is dated today or before (`paymentDay`): a future day was counted in this
  month's "collected" the moment it was typed.
- ⚠️⚠️ **Code before I10 writes payments without receipts.** When 0059 reaches a database before
  the code that writes receipts — a workspace migrated from a machine running newer code —
  those payments would be missing from "collected" and credit for good. So the auto-migration
  runs `healPaymentsWithoutReceipt` once per process and workspace: one idempotent statement.
- Merging two companies moves their receipts (`merge-children.ts`).

The company page's "Payments received" card, the order and invoice payment cards and the
correction dialog (`receipt-edit-dialog.tsx`) are the screens. `src/lib/receipts.test.ts`
(PGlite); `scripts/mutations/receipts.json`.

#### A deposit invoice, and the balance that takes it off

[src/lib/invoice-deposits.ts](src/lib/invoice-deposits.ts), migration `0060_the_deposit_and_the_balance`
(I11, decision R6: the usual way). From an order, "Deposit invoice" makes a **TD02** draft for an
amount or a share of the order; the invoice for the rest ("Balance invoice") lists the whole
order and takes each issued deposit off.

- ⚠️⚠️ **Both are split by VAT rate, in the order's proportion.** The deposit is one line per
  (rate, Natura) of the order; the balance takes off each deposit's *taxable* per rate
  (`deductionLines`), never its gross — so deposit + balance is the order, and no VAT is charged
  twice. A rate taken below zero (the order shrank) is a draft problem, `deduction_exceeds`.
- ⚠️⚠️ **Deduction lines are generated, never stored as typed lines.** `invoice.deducts` names
  the deposits on the balance draft; the lines are rebuilt on every read and save, carry
  `isDeduction`, and stay out of the document discount base (`own` in `fatturapa/totals.ts`) —
  a discount on what was already invoiced would be a second discount.
- ⚠️⚠️ **The issuing statement decides that a deposit is taken off once.** Its `deduct` CTE sets
  `deducted_in_invoice_id` on each TD02 only while null and while no credit note touched it, and
  `next` numbers the balance only if every one was taken. A deducted deposit cannot be credited;
  a credited one cannot be deducted.
- ⚠️ A TD02 is a receivable (`RECEIVABLE_TYPES`) and shares the invoices' numbering. A payment on
  the order goes to the deposit invoice (`linkOrderPayments` reads TD01 and TD02), never to the
  balance. A deposit received with no deposit invoice shows on the order as one to invoice, with
  that amount proposed. "Orders to invoice" counts only a TD01 not credited in full: a deposit does
  not invoice an order ([src/lib/orders-to-invoice.ts](src/lib/orders-to-invoice.ts)).
- The XML carries TD02 and one `DatiFattureCollegate` per deposit taken off, both checked against
  the XSD.

`src/lib/invoice-deposits.test.ts`, `src/lib/invoice-issue.test.ts` (PGlite);
`scripts/mutations/deposits.json`.

#### Cash figures, and a figure that did not load

[src/lib/cash-stats.ts](src/lib/cash-stats.ts) (I14), the Cash section at the top of Finance: collected
this month, DSO, collection rate, deposits to invoice, customers' credit, and collected against
invoiced by month. **Each figure's definition is written in that file and printed under the number**
(`finance.cash.*Def`): collected is receipts by the day they arrived, refunds included; invoiced is
invoices and deposit invoices by issue date less credit notes; DSO is owed now ÷ invoiced in 90
days × 90; the collection rate is paid ÷ asked, gross on gross, over invoices of the last twelve
months already due, paid capped at what each asks. Per currency, never summed across two.

- ⚠️⚠️ **A figure that did not load is not a zero.** `loadOutcome` ([src/lib/load-outcome.ts](src/lib/load-outcome.ts))
  tells a failure (logged, shown as "Unavailable") from a plan without the module (card absent),
  and lets Next's redirects through. The home's money dashboard used `.catch(() => null)` and
  `?? 0`, so a database that did not answer showed "€ 0 overdue". Use it for any new money figure.
- The old Finance cards are now "Sales: won and orders": they were called revenue and are not cash.
- **A customer's statement of account**: `GET /api/companies/{id}/statement?from&to` (CSV, the
  button on the customer's Payments card), built by [src/lib/customer-statement.ts](src/lib/customer-statement.ts):
  invoices and refunds as debit, credit notes and receipts as credit, the balance after each, an
  opening balance for a period. ⚠️ Money is counted once, as the receipt — never per allocation.

`src/lib/cash-stats.test.ts`, `src/lib/customer-statement.test.ts` (PGlite), `src/lib/load-outcome.test.ts`;
`scripts/mutations/cash-stats.json`.

#### Installments

[src/lib/payment-terms.ts](src/lib/payment-terms.ts), migration `0062_in_installments` (I12, "mode A"
of R6: one invoice paid in parts). A customer has usual terms (`company.payment_terms`, a preset
key); an invoice has its own (`invoice.payment_terms`: a preset or installments written by hand),
starting from the customer's. Issuing turns them into dated amounts from the issue date and the
total and freezes them (`invoice.installments`, the last one also `due_date`) in the numbering
statement.

- ⚠️⚠️ **"gg d.f.f.m." counts months**: the end of the Nth month after the invoice's month, as
  Italian ledgers read it. 31 January at 30 days is 28 February, not 31 March.
- ⚠️⚠️ The XML carries `TP01` and one `DettaglioPagamento` per installment when there are several
  (checked against the XSD); one installment stays `TP02`. Shares add up to the cent (`shareOut`).
- ⚠️⚠️ **Receivables read per installment** (`installmentStates`): payments settle the earliest
  first, a credit note reduces the last. An invoice is as late as its first installment still
  owed, `overdueAmount` is only what is past due, and each installment ages in its own bucket.
- ⚠️ Installments written by hand must add up to the total: a draft problem (`installments_total`)
  on screen as typed, and again at issue. A credit note has none.
- The bank reads an amount equal to the next installment as exact (`installment_exact`).

`src/lib/payment-terms.test.ts`, `src/lib/receivables.test.ts`, `src/lib/fatturapa/xml.test.ts`;
`scripts/mutations/installments.json`.

#### Bank reconciliation

[src/lib/bank/](src/lib/bank/), migration `0061_what_the_bank_says`, `/dashboard/sales/bank` (I13).
A statement — CAMT.053 or the bank's CSV — is read **in the browser** and sent as normalized
movements, five hundred at a time; Flux proposes where each line goes, with its reasons, and a
person confirms. Capability `bank:reconcile` (admin), reading included: a statement is every
movement on the account, salaries and suppliers too.

- ⚠️⚠️ **A line is reconciled when receipts name it** (`receipt.bank_transaction_id`), a new
  receipt written by the confirmation (`source = 'bank'`) or receipts typed by hand before the
  statement came. There is no "matched" flag to drift from them. Undo deletes a bank receipt and
  only unlinks a hand-typed one.
- ⚠️⚠️ **The database decides that a line is explained once.** Every write naming a line takes its
  row lock and ends with `guardBankTransaction` (in `receipts.ts`, beside the allocation guard):
  receipts over the line, the other way, or on an ignored line fail the transaction.
- ⚠️⚠️ **Money already recorded comes first.** A loose receipt of the same amount near the day is
  proposed as a link and makes every new-receipt proposal unsure (`recorded_already`) — otherwise
  the transfer typed by hand as credit is collected a second time beside the invoice.
- ⚠️⚠️ **`sure` is narrow**: the whole amount explained, no credit left, no ambiguity, no
  disagreement (reference vs IBAN), no rival within 20 points, and no other line sure of the same
  document (`markContested`). Bulk confirmation acts only on `sure`, and only while the proposal's
  `key` is still the one the person saw. Nothing is confirmed automatically.
- ⚠️ The same statement imported twice adds nothing: a fingerprint of day, amount, bank reference
  and description, unique per account. Identical lines in one file are numbered over the **whole
  file** by the page (`numberRepeats`) — numbered per chunk, the second of two payments would have
  been taken for the first.
- ⚠️ The XML is read by `xml-lite.ts`, not `DOMParser` (tests) nor a library (the Worker bundle).
  Only booked entries; a batch is split only when its details add up to it.
- ⚠️ The CSV mapping is stored per account **by header name**: a bank adding a column asks for
  the mapping again instead of shifting every field. Files may be Windows-1252.
- The payer's IBAN is learned on every confirmation (`company_iban`) and unlearned on undo; a
  company merge carries it (`collidesOn` in `merge-children.ts`).
- The bank never pays an invoice beyond what it owes (`overpays`); the rest is the customer's credit.

`src/lib/bank/*.test.ts` (reconcile on PGlite); `scripts/mutations/bank.json`.

#### The accounting rules the database keeps (audit, 29 September 2026)

Every rule below was a way to issue, pay or count money wrongly **with a 200 on screen**. Each is
enforced where two requests racing cannot both pass: in one transaction (`together()`,
[src/lib/db-together.ts](src/lib/db-together.ts)), row locks taken in a statement of their own
first, then a guard read after the write that fails the whole transaction with a message naming
the rule (`'overpays:' || id` cast to int, or a row-dependent division by zero).

- ⚠️⚠️ **The issuing statement is the gate** ([src/lib/invoice-issue.ts](src/lib/invoice-issue.ts)).
  Its `ok` CTE requires: the issue date is today in Rome; for a TD01, no other open TD01 on the
  order and no issued deposit left out of `deducts`; for a TD02, deposits not above the order's
  total. The order row is locked first. **Every** write of the statement (credit, deduct,
  numbering, the SDI progressive) depends on `ok` — a data-modifying CTE runs whether or not its
  result is read, so one that forgets to name `ok` writes anyway.
- ⚠️⚠️ **An invoice never receives more than it owes** (`guardInvoicesNotOverpaid`): what arrives
  beyond it is the customer's credit, said on screen (`toCredit`), and a credit note after a payment
  moves the excess to credit (`releaseOverpayment`, also a button on an overpaid invoice). A refund
  never exceeds the credit (`guardCustomerCredit`, under the company's lock).
- ⚠️⚠️ **A receipt from the bank keeps the bank's amount and day**, and taking one of its payments
  back leaves the money as credit — the Bank page undoes the match. The confirmation dialog says
  which of the three things will happen (`payment-remove-button.tsx`).
- ⚠️ A cancelled order gives its deposits back as credit; lines of an order with an issued invoice
  are fixed (`orderInvoiced`); a company with issued invoices or receipts is not deleted
  (`companiesWithAccounts`); a credit note for a deleted company is written from the original's
  snapshot; a non-EUR draft and an installment dated before the issue are draft problems.
- ⚠️⚠️ **Two series, one file name.** The SDI file name's progressive is per workspace, not per
  series: a series ≠ '' draws `sdi_progressive` from its own counter (migration `0063_one_name_per_file`,
  `SERIES_PROGRESSIVE_BASE`), so invoice 1/A and invoice 1 are not both `IT…_00001.xml`.
- ⚠️ "Owed", "overdue" and "to collect" are the receivables schedule's everywhere: the invoice
  list's filters (`?status=unpaid|overdue`), its payment column, the invoice page's badge and
  installments, and the reminder. A figure on the home opens the list it counts:
  `?issued=YYYY-MM` for "invoiced this month", `?status=to_invoice` for orders — one condition,
  [src/lib/orders-to-invoice.ts](src/lib/orders-to-invoice.ts); an invoice credited in full
  invoices nothing.
- **Reminders** (`sendPaymentReminder`, migration `0066_a_reminder_sent`): what is overdue, from
  the first installment still owed, in the customer's language, with the IBAN for a transfer.
  Claimed by a conditional update (once an hour); a failed send gives the claim back.
- **SDI**: issuing numbers an invoice, it does not send it. Until its XML is downloaded once
  (`xml_downloaded_at`, migration `0065_the_file_went_out`, stamped by the download route) the
  page says it must reach SDI.
- ⚠️ Report periods (`periodOf`) and days are on the workspace's clock: `new Date("2026-09-01")`
  is UTC midnight, and on Workers `T23:59:59` is UTC too.

`src/lib/invoice-issue.test.ts`, `src/lib/receipts.test.ts`, `src/actions/payment-reminder.test.ts`,
`src/lib/metrics.test.ts`; `scripts/mutations/{invoices,receipts,payment-reminder,home-dashboards}.json`.

#### The money rules on a real Postgres

`src/lib/money-on-postgres.test.ts` runs the rules above through the driver production uses
(`createTenantDb` → `pg` pool → `batchOnPool`), with **real** races: two payments crossing on one
invoice, two refunds on one credit, one credit on two invoices, the same draft issued twice, five
drafts at once, the same invoice sent to SDI twice — each ten times. PGlite is one connection and
cannot race, so a guard that only works when nothing else runs passes every other test.

```bash
docker run --rm -d --name flux-test-pg -p 55432:5432 -e POSTGRES_PASSWORD=flux -e POSTGRES_DB=flux_test postgres:16
FLUX_PG_TEST_URL=postgres://postgres:flux@localhost:55432/flux_test npx vitest run src/lib/money-on-postgres.test.ts
```

Skipped without the variable, and refused for anything but a local address: it drops the schema.
⚠️⚠️ It found one on its first run (29 September 2026): two payments crossing on one invoice —
the database let the first take what was owed and refused the second, so a transfer that had
reached the bank was not recorded. `recordInvoicePayment` now reads what is owed again and records
it, the rest as credit.

### Transmitting to SDI through an intermediary

[src/lib/sdi/](src/lib/sdi/), migration `0067_through_an_intermediary`, Settings → Invoicing →
"Transmission to SDI". Like every CRM that issues Italian e-invoices, Flux does not talk to SDI: it
hands the FatturaPA file to an accredited intermediary and reads back what SDI said. **Aruba first**;
every intermediary is one file implementing `SdiProvider` (`types.ts`) and one line in
`registry.ts` — the settings, the sending, the job and the invoice page read that list only.
"Manual" stays a channel: download the XML, then "mark as sent".

- ⚠️⚠️ **The claim decides who sends.** `sendToSdi` moves the invoice to `sending` with an update
  that applies only while nothing valid reached SDI (`maySend`: none, `send_failed`, `error`). A
  second copy at SDI is discarded as a duplicate — and takes the first one's status with it.
- ⚠️⚠️ **Aruba is the transmitter** (IdTrasmittente IT01879020517; anything else is refused with
  0094). The intermediary's code is frozen on the invoice (`sdi_transmitter`) at issue
  (`prepareForSdi`, before the archive) and by the claim, and the XML is built with it; the SHA-256
  of what was sent is kept, and `readInvoiceFile` never serves an archived XML built with another
  transmitter (`sentOtherwise`). The file downloaded is the file sent.
- ⚠️⚠️ **One Aruba sign-in per minute per IP**, a token for 30 minutes: the token is kept in
  `sdi_setting`, encrypted, and reused by every isolate until it is about to expire (then the
  refresh token, then the password). A sign-in per call would lock the account at the second
  invoice. The password is encrypted with the platform key and is in the key rotation; the tokens
  are not (unreadable → a new sign-in).
- ⚠️⚠️ **`sdi-status` (every ten minutes) is what makes a discard visible.** It asks about
  `pending` invoices, and `delivered` ones of a public administration (six-character recipient code,
  in SQL — a delivered B2B invoice left among the candidates would crowd out the waiting ones), at
  most `STATUS_PER_RUN` per workspace (Aruba: twelve reads a minute), longest unasked first. A status
  only moves forward (`laterStatus`); only the run whose conditional update wrote a change notifies
  whoever issued the invoice, once. A send stuck in `sending` for 15 minutes becomes `send_failed`
  with "check the intermediary's portal first": whether it arrived is unknown.
- Sending is `invoice:issue`'s (admin): what reached SDI cannot be taken back. Automatic sending
  after issue is off by default and runs in `after()`, after the archive, never failing the issue.
- The invoice page says what is missing (`sdi-panel.tsx`); the list filters "SDI problems"
  (`SDI_ATTENTION`). A discarded invoice is, for the Agenzia, not issued: the page says to fix and
  re-issue within five days with the same number and date — ⚠️ **not yet automated**: re-issuing a
  discarded invoice with corrected data is still manual.
- ⚠️ **No real Aruba account has been through this.** Written against the published API
  (docs.html, v1 upload and `getByFilename`), tested with recorded answers. Try it on Aruba's demo
  system first (`environment: demo`); the account needs the API enabled and the issuer's VAT number
  associated (asynchronous error FATRSM205 otherwise).

**Fatture in Cloud** ([fattureincloud.ts](src/lib/sdi/fattureincloud.ts), migration
`0068_whatever_went_out`) is the other shape an intermediary can have, and the interface carries
both: `send` receives Flux's file **and** the invoice as data (`OutgoingInvoice`).

- ⚠️⚠️ **It takes no FatturaPA file.** Its API sends to SDI only documents created in it, from
  JSON; the invoice is created there (Flux's number, date, customer, the XML's detail lines, rates
  by id from its `vat_types` — percentage *and* Natura — installments) and then sent. It builds the
  XML with its own transmitter: `transmitter` is null, and the file it sent is fetched and kept
  (`sdi_sent_xml`), which `readInvoiceFile` serves before anything else.
- ⚠️⚠️ **Its totals are its own**, and its maintainers say its rounding cannot be changed. The
  created document's net, VAT and gross are compared with the frozen ones to the cent; on any
  difference it is deleted and nothing is sent (`totals:` in `sdi_message`, said in words on the
  invoice page). A send it refuses deletes the document too: nothing may stay there holding the
  number. A deposit invoice (TD02) is refused, not sent as an ordinary one.
- ⚠️⚠️ **`ei_status` has no "delivered"** (the SDK's enum, 2.1.3): a B2B invoice stays `sent`. It
  is read as pending, and as delivered only after `DISCARD_WINDOW_DAYS` (SDI must discard within
  five) — never earlier, or a late discard would be refused as a status going back.
- Signed in with a token made in Fatture in Cloud (Settings → Connected applications), which does
  not expire; the company is `sdi_setting.account_id`, taken by "check" when the token reaches one.
  ⚠️ Invoices of the same series must not be issued from Fatture in Cloud too: the numbers collide.
- ⚠️ **No real Fatture in Cloud account has been through this** either, and three fields are the
  SDK's names untried: `country_iso`, `ei_data.invoice_number`/`invoice_date` for a credit note's
  original, `options.fix_payments`. The totals check is what stands between a wrong mapping and SDI.

`src/lib/sdi/aruba.test.ts`, `src/lib/sdi/fattureincloud.test.ts`, `src/lib/sdi/transmit.test.ts` (PGlite), the SDI race in
`src/lib/money-on-postgres.test.ts`; `scripts/mutations/sdi.json`.

### Accepting a quote is signing it

[src/lib/quote-signature.ts](src/lib/quote-signature.ts), migration `0049_signed_by_name`
(decision D5: a *firma elettronica semplice*; an advanced one through a provider is still
open). The public page asks for a typed name and a ticked consent; `POST /api/quotes/public`
with `action: accepted` and no `signerName` / `consent: true` is a 422
`signature_required`. Declining is not signed.

- ⚠️⚠️ **The record is the signature.** Stored on the quote: the name, the consent text,
  when, the address, the browser and the SHA-256 of the PDF being accepted — whose bytes
  are kept in object storage (`signed_pdf_key`), because the PDF carries its creation date
  and a rebuild would never match the fingerprint again.
- ⚠️⚠️ **The consent text is the server's**, rebuilt in the customer's language from the
  quote number (`consentText`). A text sent by the page could say anything.
- ⚠️⚠️ **The signing update decides**: it applies only while the quote is `sent` or
  `viewed`, so two clicks sign once and the loser deletes the PDF it uploaded.
- ⚠️⚠️ The address is `clientIp` ([src/lib/client-ip.ts](src/lib/client-ip.ts)): `cf-connecting-ip`
  on Workers, `x-vercel-forwarded-for` on Vercel *only*, else the last hop of
  `x-forwarded-for`. The Vercel header used to be trusted everywhere, and on Workers a client
  writes it freely — any address on a signature, and a new one per request past every limit.
- ⚠️⚠️ **What the link shows is listed field by field** (`shownQuote` in
  [src/lib/quote-public.ts](src/lib/quote-public.ts)): who signed and when, never the address,
  the browser, the storage key — nor the manager's internal approval note, which the row minus
  a few fields used to hand anyone the link was forwarded to.
- ⚠️⚠️ **Every status the link writes is conditional**: a decline racing a signature is a 409,
  and a first view racing one does not turn it back into viewed.
- ⚠️⚠️ **A quote leaves draft and its content is fixed** (`updateQuoteAction`): lines, notes,
  expiry and recipient change only in draft. The customer may be reading — or signing — the
  old text; a change is a revision.
- ⚠️ The page `/q/[token]` reads the quote directly, never through its own API: fetched from the
  server, every customer shared the server's rate-limit bucket.
- ⚠️ No storage configured: the signature still stands on its record and fingerprint,
  with no file beside it. `/api/quotes/{id}/signed-pdf` serves the kept bytes only
  while they still match the fingerprint (409 otherwise).

The PDF is built by `buildQuotePdf` in [src/lib/quote-pdf-load.ts](src/lib/quote-pdf-load.ts),
the same function the download route uses, so what is signed is what was on screen.
`src/lib/quote-signature.test.ts`, `src/app/api/quotes/public/route.test.ts`;
`scripts/mutations/quote-signature.json`.

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

**The mark is one drawing** ([scripts/brand/flux-mark.mjs](scripts/brand/flux-mark.mjs)): the looped
square (⌘) as one closed strand in four ribbons, each one tone (its bar and its loop), the colour
changing smoothly where one hands over to the next, each starting on top of the one before. On the
navy tile it is every icon in `public/icons/`, the 18 launch images, the opening screen and
`BrandMark` (the sidebar, the sign-in pages); the logos with the name are in `public/brand/`
(`flux-logo-crm.png` is the one to upload as a workspace logo).
- ⚠️ SVG has no gradient along a curve, so the strand is fine slices, each reaching back over the one
  before by more than its own length — otherwise a hairline shows between them when downscaled.
- ⚠️ `public/icons/` is served cache-first by the service worker: new icons need `VERSION` bumped in
  `public/sw.js`, or installed apps keep the old ones.
- The name in `public/brand/` is Plus Jakarta Sans (SIL OFL) converted to paths; the script that set
  it is not in the repository (it needs opentype.js), so those files are the source for the name.

**One opening screen: the system's.** The mark alone on navy (`#15224d`), on both platforms.
- Android paints the manifest's `background_color` with the icon in the middle.
  ⚠️ The manifest's `any` icons are the mark alone on transparency
  (`launch-mark-*.png`): a tile behind it, even a flat one of the launch colour, still
  showed as a square. The maskable icons are flat in the launch colour (`LAUNCH_BG` in
  `scripts/generate-pwa-icons.mjs`), for Android 12+, which draws them in a circle.
  ⚠️ A changed icon gets a **new file name**: an installed app keeps what it fetched
  by URL. `icon-192.png` stays the tile, for notifications.
- iOS shows an `apple-touch-startup-image` for the exact screen size. There are
  18 of them in `public/splash/`, generated by `npm run generate:icons` from
  `src/config/splash-screens.json`. Without one iOS opens on white. ⚠️ They are plain navy,
  with no mark: the opening animation draws it.
- **The opening animation** ([launch-animation.tsx](src/components/pwa/launch-animation.tsx),
  2 October 2026): a line draws the mark ribbon by ribbon in its tones, the finished mark
  (`launch-final-512.png`) settles over it, the name rises, and it lifts at ~2.2 s once the page
  has loaded. ⚠️⚠️ It continues the system's launch screen and is never a second one (a page
  splash after the system's read as two, and was removed for that): on **iOS** (`draw`) it starts
  from the plain launch image; on **Android** (`retrace`) the system has already shown the mark,
  so it starts from it, fades it to a watermark and traces it again. ⚠️ Only in the installed app
  (`display-mode: standalone`), once per session — in a browser tab it covered the page at every
  new session. `?splash=draw|retrace` plays it anywhere, to look at it. It can never trap anybody:
  lifted on `load`, by a 5 s timer, hidden at 6 s by CSS, and never shown without its script;
  reduced motion gets the finished mark at once. The strokes and the final image come from the same
  geometry (`launch-mark.generated.ts`, written by the generator) — never edit one by hand.
- The home-screen icon on iOS (`apple-touch-icon.png`) and the favicon keep the
  gradient tile; only what Android draws on its launch screen is flat.
- Changing an icon means bumping `VERSION` in `public/sw.js`: the worker serves
  `/icons/` by name from its cache.

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
[src/lib/push-types.ts](src/lib/push-types.ts): of its twenty-two types, thirteen default
to on — `lead_assigned`, `task_due`, `sla_warning`, `sla_breach`,
`contract_renewal`, `sequence_reply`, `email_reply`, `quote_viewed`, `quote_accepted`,
`quote_declined`, `appointment_reminder`, `booking_received` and `chat_mention` — and the other nine default to off, and
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

- **Navigation lives at the bottom edge**, where the thumb is. The bar
  ([mobile-tab-bar.tsx](src/app/(main)/dashboard/_components/sidebar/mobile-tab-bar.tsx))
  is `[shortcut] [shortcut] (Create) [shortcut] [Menu]`:
  - three **shortcuts**, which a person chooses from the Menu (kept in this
    browser, [mobile-nav-prefs.ts](src/app/(main)/dashboard/_components/sidebar/mobile-nav-prefs.ts)),
    defaulting to Dashboard, Contacts and Calendar;
  - **Create**, raised in the middle, opening a sheet of everything the person may
    create with the current section's record first ([mobile-create-sheet.tsx](src/app/(main)/dashboard/_components/sidebar/mobile-create-sheet.tsx));
  - **Menu**, opening the navigation hub *from the bottom*
    ([mobile-menu-hub.tsx](src/app/(main)/dashboard/_components/sidebar/mobile-menu-hub.tsx)):
    account, search, every section as tiles with its reports as chips,
    administration, language, currency, theme, workspace switch and sign-out.
    Language and currency had no way in on a phone before it.

  ⚠️ The shortcuts come from `pickMobileTabs`, which orders the **already
  filtered** menu and adds no permission rule of its own — a second copy of that
  rule is what would drift. A person's own choice is only a `preference` passed
  to it, so a pinned page they may no longer open is simply not found.
  `scripts/mutations/filter-nav.json` and `filter-nav.test.ts` hold that line.
- **The top bar says where you are** ([mobile-page-title.tsx](src/app/(main)/dashboard/_components/sidebar/mobile-page-title.tsx)):
  the page's name, and on anything below a menu entry (a record, an unlisted
  settings page, a report under Pipeline) a back arrow to the entry above it.
  Installed, the app has no address bar, no tab title and — on iOS — no back
  gesture; this is all of them. Search is the icon beside it, then notifications.
- **What opens from the top bar fills the screen**, as the search does: the bell and the recents
  open a [FullScreenPanel](src/components/crm/full-screen-panel.tsx) below md (fixed header with
  one action, list that scrolls, footer) and keep their dropdowns from md up. A notification row
  is one target — tapping opens what it is about and marks it read — grouped by day, with "To
  read" as a filter. A new panel in that bar uses the same component: a 320px dropdown on a phone
  is a third of the screen with the page still under it to tap by mistake.
- ⚠️⚠️ **Back is an app's, not a browser's** ([back-plan.ts](src/lib/back-plan.ts),
  [back-controller.tsx](src/components/back-controller.tsx)). In order:
  1. something open on top (dialog, sheet, panel, the Menu, a chat conversation) closes, one layer
     at a time;
  2. else the page's back arrow — the top bar's, from `locate` in
     [back-target.ts](src/navigation/back-target.ts), so arrow and button never disagree;
  3. else, anywhere but the home, the home;
  4. on the home, the system's Back: the app closes.
  - ⚠️⚠️ Back used to walk the history, which is the order things were tapped: it went to an
    unrelated section, and when the history ran out on a page other than the home it closed the
    app (reported 2 October 2026). Going up still uses the history when the page above is right
    behind (`go`), else *replaces* the page, so the home ends at the bottom of the history.
  - ⚠️⚠️ **One CloseWatcher for the whole app**, in `BackController` (dashboard layout), armed whenever
    Back has something to do and disarmed on the home with nothing open. Never one per layer:
    Chrome groups the watchers a page makes without a fresh tap and closes a group on one Back.
    The dialogs register in `backLayers` (`useBackDismiss`, in the primitives: a new dialog has it).
  - ⚠️⚠️ **Only an open dialog is a layer: `<BackDismiss>` sits inside Radix's Content.** The shadcn
    wrapper (`DialogContent`, `SheetContent`…) is mounted whenever the dialog is in the tree, open
    or closed; the hook used to be called there, so every closed dialog on a page was an "open"
    layer — four on the home before anything opened — and Back closed those ghosts while the real
    panel stayed open (the `?backdebug=1` log showed it, 2 October 2026). The history versions before
    had the same root: a history entry per closed dialog, pushed at every page load. Checked in
    Chrome at phone width with the real primitives; `use-back-dismiss.test.ts` holds the placement.
    Re-arming after each Back needs no tap on desktop Chrome (six Escapes, six closes), but on a
    phone the first Back worked and every later one did nothing: a watcher armed without a tap is
    **made again at the next tap** (`withTap`, `navigator.userActivation`).
  - `?backdebug=1` shows a log of what the controller does at the top of the screen, on a real
    phone; `?backdebug=0` hides it (kept in localStorage).
  - What is behind the current entry is mirrored (`createHistoryMirror`): `pushState` and
    `replaceState` are wrapped (Next patches them too; both run).
  - **Without CloseWatcher** (Safari, Firefox) only the layers are handled, by the history entries
    below; page-to-page Back stays the browser's.
  - ⚠️⚠️ **The open layers are counted in memory, never written into `history.state`**: Next's router
    rewrites the current entry's state on every refresh, and the first version lost its layers there.
  - ⚠️⚠️ **Closing a layer never moves the history.** A `history.back()` on close is a navigation to
    Next, which discards what it has in flight: a record saved in its edit dialog closes it and
    refreshes the page at once, and the refresh was thrown away; a link from the Menu was cancelled.
    A closed layer's entry stays, *spent*: the next layer on the same page takes it over, and a Back
    with nothing open skips the spent entries and the page's own with one `history.go(-n)`.
  - ⚠️⚠️ **Spent entries are counted per page**, and the skip happens only for a Back pressed *on*
    the page. Kept for one page at a time, a layer closed on a second page forgot the first's, and
    coming back took a Back that did nothing; coming back from another page lands on the newest
    spent entry, which shows the page, and skips nothing. To know where a Back came from,
    `pushState`/`replaceState` are wrapped (Next patches them too; both run).
  - A screen that is a layer without being a dialog uses the hook directly: an open conversation in
    the chat, on a phone, is one (`BackToList`), so Back returns to the list instead of leaving.
  - ⚠️ The full-screen panel draws its close button in its own header (`ownCloseButton`); the
    dialog's default one is `z-20` and moves up on a touchscreen, where every button is 44px tall.
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

The menu trigger is **first on the left of the header from `md` up**, because
that is the edge the sidebar comes out of; below `md` there is no trigger and no
sidebar — the bar's Menu opens the hub from the bottom edge instead. (A menu slot
used to be rejected for opening a left-hand panel from the right; a bottom sheet
answers that.) `interactive-widget=resizes-content` in
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
4. Fire webhooks via `dispatchWebhook(...)` from `@/lib/webhook-dispatch` (fire-and-forget), with a
   name from [src/lib/webhook-events.ts](src/lib/webhook-events.ts)
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

### Who sees which customer

[src/lib/record-visibility.ts](src/lib/record-visibility.ts) (decided 1 October 2026; it reverses
D-D). Several salespeople in one workspace must not read each other's customers.

- **Administrators and the owner see everything** (`record:manageAny`), and so does Flux staff.
- **Everybody else sees** leads, contacts, companies and deals they own, those assigned to one of
  their groups, and those assigned to nobody (no owner, no group) — the pool anybody may take on.
- **A customer is seen through what one works on**: a company's owner sees its contacts and deals;
  a deal's or contact's owner sees the company. Only through records one *owns* (or one's group
  does): an unassigned company opens none of the contacts filed under it.
- **What hangs off a customer follows its most specific link** (deal, then contact, then lead,
  then company): quotes, orders, contracts, invoices, tasks, activities, appointments, attached
  documents, the record timeline, the customer panel. ⚠️⚠️ The most specific, not any: a
  colleague's call on their own deal also names the company, which one may see through one's own
  deal.
- What a salesperson creates naming no owner and no group is theirs (`ownerOnCreate`).
- Settings → Users, "Who sees which records": `team` (the default, also when no row exists or the
  read fails) or `all`, everybody everything as before.
- ⚠️⚠️ **A request with nobody behind it sees everything**: jobs, API keys, webhooks, public
  pages. A signed-in person calling `/api/crm` reads by the rules.
- Not scoped: tickets (the support desk's shared queue), campaigns and segments used to send.

How to apply it:
- **A list, picker, count or report** ANDs `visibleWhere(kind, await recordScope())` into its
  WHERE. It is `undefined` for whoever sees everything.
- **A record page** reads its row with the clause and answers `notFound()`.
- **An action taking an id** calls `assertCanSee(kind, id)`, which refuses as "not found": a
  refusal naming the record would confirm it exists.
- **A bulk action** narrows its ids with `visibleIds`.
- A duplicate warning still says a colleague's record exists, and whose it is, with no details.
- ⚠️ The clauses name the tables as written (`"company"."id"`). For an `alias()`, a foreign key,
  or a relational query (`db.query.x.find*` aliases its root table), use
  `inVisible(kind, column, scope)`.
- ⚠️ A company's visibility asks per row whether one of its contacts or deals is somebody's:
  `contact(company_id)`, `deal(company_id)` and `deal(contact_id)` are indexed for it (migration
  `0072_who_sees_what`).
- ⚠️⚠️ **`src/lib/record-visibility.inventory.test.ts` reads every server action, dashboard page
  and route**: one that selects from a customer table without a visibility helper fails it,
  unless `EXEMPT` names it with the reason.

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

### Record pages share one layout

Every detail page (deal, contact, company, lead, order, invoice, quote, contract,
ticket, campaign, sequence, price list) is built from
[src/components/crm/record/](src/components/crm/record/), and the deal page
(`pipeline/[id]/page.tsx`) is the reference. The layout follows the order of the
questions a rep asks:

- **Hero** (`RecordHero`): status badges, the title, a meta line of links to related
  records, and at most three everyday actions.
- **Metric strip** (`MetricStrip`/`Metric`): the two to four figures that decide what
  happens next, with "in N days" or an overdue warning under a date.
- **`RecordSections`**: from `lg` up, the work (`main`) sits beside the reference
  material (`side`). Below `lg`, one tab at a time behind a sticky segmented bar,
  with counts.

⚠️⚠️ **A section is rendered once and only hidden (`max-lg:hidden`), never mounted
twice.** The desktop card and the mobile tab are the same node, so a half-typed form
survives a rotation and a card that loads its own data loads it once. Rendering the
section again for mobile would double every such fetch and lose input on resize.

⚠️ Status colours come from `StatusBadge`'s five tones: green means the same thing
on every record. `Field` hides empty values, because a card of "—" is not read.

A new detail page uses the kit. When a page is an editor rather than a record
(quote edit, sequence editor), it takes the visual language and not the two
columns.

**On a phone a record is designed, not shrunk.**

- **Actions:** the hero's actions are one row of icon-over-label tiles.
- **Tab bar:** `RecordTabBar` is equal columns and never scrolls sideways. A tab
  bar that scrolled hid its last subject off the edge.
- **Add forms:** a form that adds to a section (a task, a note) goes in
  `RecordComposer`, folded behind one button, so the tab shows the list and not
  the form.
- **Long editors:** editors split into tabs with the same bar. These are the quote
  (new and edit), order, invoice and contract forms. A failed save jumps to the tab
  holding the error. Lines fold to a summary row and open one at a time.
- **Deal stages:** the stage path is a bar plus a "Change stage" menu.
- **Save bars:** a save bar pinned to the bottom carries `data-bottom-bar`, which
  moves the chat bubble off its Save button.

⚠️ A constant exported from a `"use client"` file reaches a server component as a
client reference, not as the value. `LEAD_STEPS.includes` threw "is not a
function" and took the lead page down, so constants live in their own module.

### Pipeline filters

Every page under `/dashboard/pipeline` reads the same URL parameters —
`owners=a,b,none|all`, `period`, `status`, `q` — parsed and turned into SQL by
[src/lib/pipeline-filters.ts](src/lib/pipeline-filters.ts), drawn once by the section
layout. ⚠️ `none` is `IS NULL`, never `IN (NULL)`. `PIPELINE_VIEWS` says which controls
each page has; a new page goes there.

**The board has a list view** ([pipeline-list.tsx](src/app/(main)/dashboard/pipeline/components/pipeline-list.tsx)):
a section per stage, the deals as rows, a "needs attention" filter and a sort. It is what
the pipeline opens on below 1024px, and each kind of screen remembers its own choice in
the browser. A deal moves by picking its stage from a sheet
([stage-picker.tsx](src/app/(main)/dashboard/pipeline/components/stage-picker.tsx)). That
sheet is also in the Kanban card's menu, and it goes through the board's own
`requestMove`, so a move asks for the loss reason and the next step exactly as a drop does.

⚠️ **Below lg the filter bar is a different layout**
([pipeline-filter-bar.tsx](src/components/crm/pipeline-filter-bar.tsx)): the tabs become
one section menu, the search takes the row, and every other filter goes in a sheet
behind a "Filters" button. What is switched on shows as removable chips that wrap. The
cut-off is lg, not md: beside the sidebar an upright tablet has 524px for 715px of tabs.
Nothing in this section scrolls sideways except the Kanban board itself.

⚠️ Nothing above a dashboard page is bounded in height, so the **document** scrolls, and
the `overflow-y-auto` boxes in the layouts only grow. A sticky header inside them never
sticks. A page that needs one marks itself `data-sticky-sections`. The dashboard and
pipeline layouts then drop those boxes to `overflow-visible` and the inset to
`overflow-clip min-w-0`. Without `min-w-0` a tablet's page grew past the screen.

The board also takes `closed=2026-09` (or `2026-Q3`, `2026`): closed in that calendar
period on the workspace's clock. Nobody sets it by hand — it is how a figure elsewhere
opens the deals it counted, and the bar shows it as a removable chip.

### Consent, and a person's rights from their record

[src/lib/consent.ts](src/lib/consent.ts): `consentDate` is the date of the **latest
decision**, grant or withdrawal, and `consentSource` (migration `0040_why_they_said_yes`)
says where it came from — `form`, `import`, `api`, `unsubscribe`, `conversion`.
`marketingConsent` is in the field history, so the timeline is the proof.

- ⚠️⚠️ Every writer asks `consentPatch` (forms), `consentStamp` in the import builders, or
  `withdrawConsent` ([src/lib/consent-withdraw.ts](src/lib/consent-withdraw.ts), the
  unsubscribe link) what to write. A withdrawal used to leave the grant's date standing.
- ⚠️ `withdrawConsent` only touches a consent still given: `false` over `false` would move
  the date of an earlier decision and add a history line for nothing.
- ⚠️⚠️ **Opening the unsubscribe link unsubscribes nobody** (decided 27 September 2026): the
  GET asks, the button POSTs. Corporate mail scanners open every link, and the GET that
  acted unsubscribed people — and told every integration. The emails carry
  `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058, `listUnsubscribe` in
  [src/lib/email-provider.ts](src/lib/email-provider.ts)), so the mail client's own button
  posts in one click; Gmail and Yahoo require it of bulk senders.
- ⚠️⚠️ **One number, its spellings** ([src/lib/contact-point.ts](src/lib/contact-point.ts),
  decided 27 September 2026): a number written without `+`/`00` is of the workspace's
  country (the invoicing country, Italy when unset), so «+39 333…» and «333…» are one person
  for opt-out, the assistant, erasure and subject access. A national number is never cut —
  a TIM mobile starting 393 stays whole — and a trunk 0 (London's 020) is handled.
- A contact or lead page shows holders of `privacy:manage` (admin) a Privacy card: export
  everything about the person ([src/lib/subject-access.ts](src/lib/subject-access.ts), the
  same lookup as `erasure.ts`) or erase them, confirmed by typing the contact point.
- ⚠️⚠️ Erasure deletes the person's `field_change` rows. The history has no foreign key to
  its record, so nothing cascades into it, and it holds every old address.

### First run and sample data

The home page shows whoever holds `settings:manage` five steps — company details, team,
contacts, stages, email — each ticked by the data ([src/lib/onboarding.ts](src/lib/onboarding.ts),
one statement), plus "load / remove sample data" ([src/lib/sample-data.ts](src/lib/sample-data.ts)).

- ⚠️⚠️ Sample rows are recognised **only** by the `sample-` id prefix. Nothing else may
  generate ids with it; removal deletes by it, and what people attached to a sample record
  cascades with it (the confirmation says how much).
- ⚠️ Loaded only into a workspace with no deals or contacts of its own, on RFC 2606
  addresses with no marketing consent, and inserted directly — no automation, sequence or
  campaign can reach anybody because of it. Sample data never ticks "contacts".
- ⚠️ The card imports `onboarding-steps.ts`, not `onboarding.ts`: the latter pulls the
  schema into the client bundle, which the Worker's size budget cannot spare.

### The public booking page

`/b/<subdomain>/<token>` ([src/lib/booking.ts](src/lib/booking.ts),
[src/lib/booking-public.ts](src/lib/booking-public.ts), `POST /api/booking`, migration
`0041_book_a_time`): a person's free slots over the next days, from the settings on their
Profile page, and a form that turns one into an appointment in their calendar — the
visitor gets the invitation and is filed as the contact or lead they are, else a new lead
the person owns (no marketing consent).

- ⚠️⚠️ **Offered and booked are one computation**: `bookableSlots` over `busyByUser`
  ([src/lib/availability.ts](src/lib/availability.ts), the same busy time as the colleague
  picker). A start not in the list is refused, not written over something.
- ⚠️⚠️ Two visitors on one slot: the unique index on appointment `(organizer_id, start_at)`
  for booked rows decides, through `ON CONFLICT DO NOTHING` — the loser is told it was taken.
- ⚠️ Everything runs inside `runWithTenant`: `getWorkspaceTimeZone()` reads the request's
  workspace and falls back to Rome outside one, silently. The workspace comes from the
  subdomain in the address; the proxy rate-limits the POST (5 a minute per address) and a
  hidden `website` field marks a script, answered with a success that writes nothing.
- Invitations to anybody outside the dashboard go through
  [src/lib/appointment-invites.ts](src/lib/appointment-invites.ts) — a library, because as
  an export of the `"use server"` actions file it would be an endpoint anybody could call.

### Public forms: contact and support

`/f/<subdomain>/<token>` and `POST /api/forms` ([src/lib/web-forms.ts](src/lib/web-forms.ts),
[src/lib/web-forms-public.ts](src/lib/web-forms-public.ts), migration `0042_write_to_us`),
switched on and given an owner at Settings → Forms. The contact form files a lead; the
support form opens a ticket on the `web` channel, finding or creating the contact.

- ⚠️⚠️ Somebody already a contact or an open lead gets the message on their timeline — a
  second record is exactly what a web form produces otherwise.
- ⚠️ Consent is only the box the visitor ticked (`consentSource: "web"`), and a ticket's
  text is escaped before it becomes a message: the form is the one input anybody can fill.
- ⚠️ `/api/forms` answers any origin (CORS) because it reads no session; the proxy limits it
  to five posts a minute per address, a hidden `website` field marks a script, and `redirect`
  is followed only to http(s) and only on success.
- Cloudflare Turnstile when `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` are set; the site
  key reaches the page from the server, never as `NEXT_PUBLIC_*`. Without them the forms work
  on the honeypot and the rate limit — a missing check is not a failed one.
- ⚠️ `/b/` and `/f/` get `buildCsp(nonce, { embeddable: true })` in the proxy: framable by any
  site and allowed to frame Turnstile. Nothing on them is signed in; every other page keeps
  `frame-ancestors 'none'`.

### Stage history, velocity and stuck deals

[src/lib/stage-history.ts](src/lib/stage-history.ts) reads where each deal has been from the
field history (`field_change`, field `stageId`) — there is no separate stage-history table,
and every move of a deal already writes a row there (V1.7). The first stay starts at the
deal's creation.

- ⚠️⚠️ **Days in a stage are the stays that ended**, never the deal's age (which the report
  used to show). An ongoing stay is not averaged in: it would only pull the number down.
- Conversion is "moved to a later stage or won" over the deals that left the stage; ones
  still there are undecided. Won and Lost are where deals end, not stages to time.
- Sales velocity = open × average won × win rate ÷ average days to win; null, not zero,
  when nothing was won or decided.
- `pipeline_stage.stale_after_days` (migration 0043, open stages only — the action reads the
  stage's kind when the form does not send one) marks a board card "stuck" in words and
  counts it in the report.
- ⚠️ A move that does not write the history is invisible to all of this. `/api/crm/close`
  used to be one — and it also left the deal in its open column while marking it lost; it now
  moves it to the Lost stage, keeps `lostAtStageId`, and records the change.

### More than one pipeline

[src/lib/pipelines.ts](src/lib/pipelines.ts), migration `0044_more_than_one_way_to_sell`: a
`pipeline` table, and `pipeline_stage.pipeline_id` (default `"default"`, a row the migration
creates and the actions refuse to delete).

- ⚠️⚠️ **A deal has no pipeline column: it is in its stage's.** One fact, nothing to keep in
  step. Narrowing anything to a pipeline is `inArray(deals.stageId, stageIdsOfPipeline(...))`.
- ⚠️⚠️ **The won and lost columns are per pipeline.** Anything that closes a deal — the board,
  `loseDeal`, the order conversion, `/api/crm/close` — asks `closingStageFor(db, stageId, …)`;
  "the first won stage in the workspace" moves a renewal onto the new-business board as it
  closes. The one-won-one-lost rule (`checkStageKind`) is per pipeline too.
- The board, forecast, win/loss and pipeline report take `pipeline=<id>` (absent: the first);
  the board also takes `all` — every pipeline's columns side by side, labelled — which is what
  a figure counting the whole workspace (the scorecard, the home KPIs) must link to.
- The filter bar shows the selector only with a second pipeline; pickers label stages
  "Pipeline · Stage" in the same case (`getPipelineStages` adds `pipelineName`).

### The scorecard, and a number that opens its list

`/dashboard/reports/scorecard` ([src/lib/rep-scorecard.ts](src/lib/rep-scorecard.ts)): per
salesperson for a month, quarter or year — won against target, coverage (open ÷ what is
left of the target), win rate, average won, cycle, open pipeline, calls/meetings/emails.
Five grouped statements whatever the team size.

- ⚠️⚠️ Periods are target keys (`sales_target.period`), handled by
  [src/lib/calendar-period.ts](src/lib/calendar-period.ts). `targetFor` takes a target
  written for the period itself, else sums its parts — a person with monthly and quarterly
  targets is never counted twice, and no target is `null`, not zero.
- ⚠️ Every current member has a row with or without figures; the team's attainment is
  measured only over the people who have a target.
- ⚠️ A figure that counts deals links to the board with the same owner, status and
  `closed=` period. Keep it that way for any new figure: one that cannot be opened cannot be
  checked.

### Commissions accrue on the won deal

`/dashboard/pipeline/commissions` ([src/lib/commissions.ts](src/lib/commissions.ts), migration
`0051_what_the_win_pays`; decision D6 — "on payment" is to be reconsidered once I9 records
payments). A win is the scorecard's: status `won`, dated by `closedAt` on the workspace's
clock, valued in EUR — and shown in EUR, never converted to a display currency.

- ⚠️⚠️ **A rule is a rate from a day.** A change is a new rule from a later day, so a deal
  keeps the rate in force when it was won. The most specific wins — person and pipeline,
  person, pipeline, everyone — then the latest started. A win with no rule or no owner is
  listed as unpaid, never left out.
- ⚠️⚠️ **An approved month is frozen** in `commission_line`: base, rate, amount, owner. It
  is read from those lines from then on; a deal edited, reopened, reassigned or deleted
  afterwards shows a `drift` badge instead of moving what was paid.
- ⚠️⚠️ **One statement approves**: the month's row and its lines in one CTE, the unique
  index on the month deciding between two clicks, the one on `deal_id` paying a deal once.
  Only a month that is over can be approved.
- ⚠️ A win dated into an approved month (a backdated close) is `late` and paid with the next
  month approved; the wins of months never approved are not swept in.
- ⚠️ What a colleague earns is not a workspace record: without `commission:manage` (admin)
  a person sees only their own, whatever the owners filter says — the action decides.

`src/lib/commissions.test.ts`, `src/actions/commissions.test.ts`;
`scripts/mutations/commissions.json`.

### One workload rule

[src/lib/workload-allocation.ts](src/lib/workload-allocation.ts) is read by the workload page
and by the Gantt's panel, which used to disagree: no estimate counts one hour, no start date
puts the work on the due date, everybody responsible (RACI) carries it, a parent task and a
done task carry nothing. ⚠️⚠️ Days are `YYYY-MM-DD` strings end to end — the page used to
key local midnights with `toISOString()`, which in Rome put every cell a day to the left.

### Translations are checked on the screens, not only in the files

`src/i18n/coverage.test.ts` runs `scripts/i18n-audit.mjs` (text typed into a component)
and `scripts/i18n-keys-check.mjs` (a `t("key")` missing in either language). Zod
messages are `validation.*` keys translated by `FormMessage` / `useMessageText`;
messages a server action *returns* go through `serverT` in
[src/lib/i18n-server.ts](src/lib/i18n-server.ts). A thrown message never reaches the
screen in production, so it is not the place for user-facing text.

### Sidebar navigation

Defined in [src/navigation/sidebar/sidebar-items.ts](src/navigation/sidebar/sidebar-items.ts) as typed `NavGroup[]`. Add new routes here to make them appear in the sidebar.

- **Groups are kinds of work, in the order a customer meets them** (1 October 2026): Work
  (dashboard, work queue, calendar, tasks, chat) · Customers (leads, contacts, companies) ·
  Sales (pipeline with its analyses then targets and commissions, quotes, orders, contracts,
  products, price lists) · **Billing and payments** (invoices, bank, finance) · Support ·
  Marketing and automation · Analysis (reports, the assistant's contribution) · the account
  group. ⚠️ The array's order is the menu's; `id` is only a React key.

- **`need`** is the permission; an entry to a guarded page without one shows a link that
  bounces (Finance did, for every editor).
- **`audience: "manager"`** is not a permission: for anyone without `record:manageAny`
  the entry is *secondary* — left out of the sidebar and the phone's hub until they press
  "show all sections" (remembered in the browser), and always offered by the palette.
- ⚠️ **The palette's "go to" commands are generated from this menu**, already filtered
  (`navigationCommands` in [src/lib/palette-commands.ts](src/lib/palette-commands.ts)):
  a new page added here is findable by ⌘K with no second list to update. Extra words a
  section should answer to go in `NAV_KEYWORDS`.
- Text search — global, list boxes, the filter's contains/starts/ends — goes through
  [src/lib/text-match.ts](src/lib/text-match.ts): accents folded with `translate()`, not
  the `unaccent` extension, which a managed Postgres may refuse to create.

⚠️ **Optional parts are switched per workspace, not per plan.** Project planning (Gantt,
workload) and internal chat carry `feature:` in the menu; a workspace admin turns them off
at `/dashboard/settings/features`, which hides the entries, closes the pages
(`requirePageFeature`) and stops mounting the chat widget. Stored in the workspace's own
`workspace_setting` table ([src/lib/workspace-features.ts](src/lib/workspace-features.ts)) —
not in `tenants.settings`, which the platform panel rewrites whole. No row means on; new
workspaces are seeded with both off.

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

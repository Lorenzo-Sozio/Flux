# Ticket System — Implementation Plan

**Audit date:** 2026-04-24  
**Current state:** Solid core (schema, SLA, whispers, kanban, live countdown) — missing audit log, macros, email ingestion, team routing, state-machine enforcement, automation.

---

## GAP ANALYSIS

| Feature | Status | Notes |
|---|---|---|
| Ticket number (readable ID) | ✅ | TKT-YYYYMM-HEX — consider sequential |
| Subject / description | ✅ | Plain text — no Markdown render |
| Attachments | ✅ | `attachmentIds[]` FK to documents table |
| contactId / companyId FK | ✅ | |
| Ticket type (Bug/Complaint/…) | ❌ | No column |
| Priority P0–P3 | ✅ | low/normal/high/urgent (4 levels) |
| Component / product area | ❌ | No column |
| assigneeId (operator) | ✅ | |
| groupId / teamId | ❌ | No column, no group assignment |
| firstResponseAt | ✅ | Auto-set on first message |
| resolvedAt / closedAt | ✅ | Auto-set on status change |
| slaDeadlineAt (stored) | ❌ | Calculated on-the-fly only |
| Email ingestion (inbound) | ❌ | No API route, no parsing |
| Email threading headers | ❌ | No `emailMessageId` / `inReplyTo` on messages |
| Email signature stripping | ❌ | No parser |
| `new` initial status | ❌ | First status is `open` |
| `on_hold` status | ❌ | Missing; `waiting` = closest |
| State machine enforcement | ❌ | Any status → any status allowed |
| Auto-close (resolved → closed) | ❌ | No cron job |
| Internal notes (whispers) | ✅ | `isPublic=false` + amber highlight |
| Audit log table | ❌ | No table, no tracking |
| Collision detection | ❌ | No real-time presence |
| Macros / predefined replies | ❌ | No table, no UI |
| Automation engine (tickets) | ❌ | Engine exists for CRM, not wired for tickets |

---

## PHASE 1 — Data Model  
**Effort: M — 1 migration + action updates**

### 1.1 New columns on `tickets`

```sql
ALTER TABLE tickets
  ADD COLUMN type          TEXT DEFAULT 'support',       -- bug | info_request | complaint | internal_task | support
  ADD COLUMN component     TEXT,                          -- product area / category free-text or enum
  ADD COLUMN group_id      TEXT REFERENCES groups(id),   -- team assignment (groups table already exists)
  ADD COLUMN sla_deadline_at TIMESTAMP,                  -- stored deadline = createdAt + SLA minutes
  ADD COLUMN sla_paused_at   TIMESTAMP,                  -- when SLA timer was paused (waiting/on_hold)
  ADD COLUMN sla_pause_minutes INTEGER DEFAULT 0;         -- accumulated pause time
```

Status enum — add `new` and `on_hold`:
```
new → open → in_progress → waiting | on_hold → resolved → closed
```

Update `status` default to `'new'` for freshly created tickets.

### 1.2 New columns on `ticketMessages`

```sql
ALTER TABLE ticket_messages
  ADD COLUMN email_message_id TEXT,   -- SMTP Message-ID of this outbound email
  ADD COLUMN email_in_reply_to TEXT;  -- SMTP In-Reply-To from inbound email
```

### 1.3 New table: `ticketAuditLogs`

```typescript
ticketAuditLogs = pgTable("ticket_audit_log", {
  id:         text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  ticketId:   text("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
  actorId:    text("actor_id").references(() => users.id),
  actorName:  text("actor_name"),           // snapshot at time of change
  action:     text("action").notNull(),     // e.g. "status_changed" | "priority_changed" | "assigned" | "message_added"
  field:      text("field"),                // which field changed
  oldValue:   text("old_value"),
  newValue:   text("new_value"),
  createdAt:  timestamp("created_at").defaultNow().notNull(),
});
```

### 1.4 New table: `ticketMacros`

```typescript
ticketMacros = pgTable("ticket_macro", {
  id:          text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name:        text("name").notNull(),
  description: text("description"),
  body:        text("body").notNull(),         // template text, supports {ticket.number} placeholders
  isPublic:    boolean("is_public").default(true),  // false = internal note template
  createdBy:   text("created_by").references(() => users.id),
  createdAt:   timestamp("created_at").defaultNow().notNull(),
  updatedAt:   timestamp("updated_at").defaultNow().notNull(),
});
```

### 1.5 Drizzle migration steps

1. `npx drizzle-kit generate` after schema edits
2. `npx drizzle-kit push` (dev) or apply migration in prod
3. Backfill: set `status = 'open'` for all existing tickets where `status = 'new'` would be wrong
4. Backfill: compute and store `sla_deadline_at` for existing open tickets

---

## PHASE 2 — State Machine & Workflow  
**Effort: S — server action changes only**

### 2.1 Valid transitions map

```typescript
// src/lib/ticket-state-machine.ts
const VALID_TRANSITIONS: Record<string, string[]> = {
  new:         ["open", "in_progress", "closed"],
  open:        ["in_progress", "waiting", "on_hold", "resolved", "closed"],
  in_progress: ["waiting", "on_hold", "resolved", "closed", "open"],
  waiting:     ["open", "in_progress", "on_hold", "resolved", "closed"],
  on_hold:     ["open", "in_progress", "waiting", "resolved", "closed"],
  resolved:    ["open", "closed"],  // reopen or auto-close
  closed:      [],                  // immutable — reply creates new linked ticket
};

export function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}
```

Enforce in `updateTicketStatusAction` and `updateTicketAction`.

### 2.2 SLA pause/resume

In `updateTicketStatusAction`:
- Status → `waiting` or `on_hold`: write `sla_paused_at = NOW()`
- Status → any active state: add `(NOW() - sla_paused_at)` to `sla_pause_minutes`, clear `sla_paused_at`
- SLA countdown = `sla_deadline_at + sla_pause_minutes * interval '1 minute' - NOW()`

### 2.3 Auto-close cron

```typescript
// src/app/api/cron/ticket-autoclose/route.ts
// Triggered by Vercel Cron: "0 4 * * *" (daily at 04:00)
export async function GET(req: Request) {
  // Verify cron secret header
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await db.update(tickets)
    .set({ status: "closed", closedAt: new Date() })
    .where(and(eq(tickets.status, "resolved"), lt(tickets.resolvedAt, cutoff)));
}
```

Add to `vercel.json` (or `vercel.ts`):
```json
"crons": [{ "path": "/api/cron/ticket-autoclose", "schedule": "0 4 * * *" }]
```

### 2.4 Reply to closed ticket → new linked ticket

In `addTicketMessageAction`: if `ticket.status === 'closed'`, create new ticket with `parentTicketId` reference and return new ticket ID to UI.

Add `parent_ticket_id TEXT REFERENCES tickets(id)` to tickets table in Phase 1.

---

## PHASE 3 — Collaboration Tools  
**Effort: M**

### 3.1 Audit log writes

In every mutating action (`updateTicketAction`, `updateTicketStatusAction`, `reassignTicketAction`, `escalateTicketAction`, `addTicketMessageAction`):

```typescript
// src/lib/ticket-audit.ts
export async function logTicketChange(params: {
  ticketId: string;
  actorId?: string;
  actorName?: string;
  action: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
}) {
  await db.insert(ticketAuditLogs).values(params);
}
```

### 3.2 Audit log UI

In `[id]/page.tsx` — add collapsible "Activity Log" section below messages:

```
Mario Rossi → changed status: in_progress → waiting          14:32
System      → SLA deadline: 2026-04-24 16:00                 10:15
Giulia B.   → assigned to: Marco V.                          09:55
System      → ticket created via email                       09:50
```

Styled like the lead/contact timeline (existing `ActivityModal` pattern).

### 3.3 Macros / predefined replies

**Settings page:** `/dashboard/settings/macros`
- CRUD list (name, preview, public/internal toggle)
- Actions: `createMacroAction`, `updateMacroAction`, `deleteMacroAction` in `support.ts`

**Reply composer:** Add "Macros" dropdown button next to reply textarea
- Lists all macros
- On select: insert `macro.body` into textarea, set `isPublic` to match macro
- Template vars: `{ticket.number}`, `{contact.firstName}`, `{agent.name}` resolved before insert

### 3.4 Collision detection

**Simple polling approach (no WebSocket needed):**

```typescript
// src/app/api/tickets/[id]/presence/route.ts
// GET: returns array of { userId, userName, action: "viewing"|"typing", updatedAt }
// POST: upsert presence record for current user (TTL: 30s)
```

Client: poll every 15s via `useEffect`. Show banner in ticket detail:
```
👤 Giulia sta scrivendo una risposta...
```

Store in-memory (Map) or Redis if available — not in Postgres (too chatty).

---

## PHASE 4 — Email Integration  
**Effort: L — most complex phase**

### 4.1 Inbound webhook endpoint

```typescript
// src/app/api/webhooks/email-inbound/route.ts
// Receives POST from Resend / Mailgun / SendGrid inbound parse webhook
export async function POST(req: Request) {
  // 1. Verify webhook signature (provider-specific HMAC)
  // 2. Parse payload: from, to, subject, text, html, attachments, headers
  // 3. Extract Message-ID, In-Reply-To, References from headers
  // 4. Determine: new ticket or reply to existing?
  //    a. Search ticketMessages.emailMessageId in References/In-Reply-To
  //    b. Fallback: regex /\[TKT-[A-Z0-9-]+\]/ in subject
  // 5a. Match found → addTicketMessageAction (isPublic=true, senderEmail=from)
  // 5b. No match → createTicketAction (channel="email", subject=parsed, contactId=lookup by email)
}
```

### 4.2 Contact lookup / creation

On inbound email, look up contact by `senderEmail`:
- Found → link ticket to existing contact
- Not found → create stub contact (firstName from display name, email set)

### 4.3 Email signature stripping

Install `mailparser` (already parses MIME) + custom regex for common signature patterns:

```typescript
// src/lib/email-parser.ts
export function extractLatestReply(html: string, text: string): string {
  // 1. Use html: strip blockquote[type=cite] and Gmail/Outlook quoted blocks
  // 2. Strip signature: content after "-- \n" or common footers
  // 3. Fallback to text if html strip fails
  // 4. Return cleaned plain text (convert remaining HTML with html-to-text)
}
```

### 4.4 Outbound email reply

When agent posts a public message (`isPublic=true`) via `addTicketMessageAction`:

```typescript
// After inserting message, fire-and-forget:
after(() => sendTicketReplyEmail({
  ticketId,
  messageId: newMessage.id,
  toEmail: ticket.contact?.email,
  subject: `Re: [${ticket.ticketNumber}] ${ticket.subject}`,
  body: message.content,
  inReplyTo: lastInboundEmailMessageId,  // for threading
}));
```

Store the generated `Message-ID` header back on `ticketMessages.emailMessageId`.

### 4.5 Required environment variables

```
RESEND_API_KEY          # already exists
EMAIL_INBOUND_SECRET    # webhook verification secret
SUPPORT_EMAIL           # e.g. supporto@yourcrm.com
```

---

## PHASE 5 — Automation Rules  
**Effort: M — extend existing rule engine**

### 5.1 Wire ticket events into rule engine

In `createTicketAction` and `updateTicketAction`, add after existing webhook calls:

```typescript
after(() => runAutomations({
  entityType: "ticket",
  entityId: ticket.id,
  event: isNew ? "onCreate" : "onUpdate",
  oldData: previousTicket,
  newData: ticket,
}));
```

Update `rule-engine.ts` to handle `entityType === "ticket"`.

### 5.2 Automation rule conditions for tickets

| Condition field | Example |
|---|---|
| `ticket.priority` | `equals urgent` |
| `ticket.status` | `equals new` AND `age_minutes > 120` |
| `ticket.subject` | `contains "fattura"` |
| `ticket.channel` | `equals email` |
| `ticket.sla_breached` | `equals true` |

### 5.3 Automation rule actions for tickets

| Action type | Effect |
|---|---|
| `assign_to_agent` | Set `assigneeId` |
| `assign_to_group` | Set `groupId` |
| `change_priority` | Escalate/set priority |
| `change_status` | Move state |
| `send_notification` | In-app + email alert |
| `send_webhook` | Fire existing webhook engine |
| `add_tag` | Append to `tags[]` |

### 5.4 SLA breach detection

```typescript
// src/app/api/cron/ticket-sla-check/route.ts
// Schedule: "*/15 * * * *" (every 15 min)
// Finds tickets where:
//   sla_deadline_at < NOW()
//   AND status NOT IN ('resolved', 'closed')
//   AND sla_paused_at IS NULL
// For each: fire runAutomations({ event: "onSLABreach" })
//           set ticket.slaBreachedAt = NOW() (prevent re-fire)
```

---

## IMPLEMENTATION ORDER

| Phase | Blocks | Estimated effort |
|---|---|---|
| **Phase 1** — Schema | All others | 1–2 days |
| **Phase 2** — State machine | Phase 5 routing | 0.5 day |
| **Phase 3.1+3.2** — Audit log | — | 0.5 day |
| **Phase 3.3** — Macros | — | 1 day |
| **Phase 3.4** — Collision | — | 0.5 day |
| **Phase 4** — Email | Phase 5.1 | 2–3 days |
| **Phase 5** — Automation | Phase 1+4 | 1 day |
| **Total** | | **~7–9 days** |

Start with Phase 1 (migration). All other phases are additive — no breaking changes to existing UI.

---

## FILES TO CREATE / MODIFY

```
src/db/schema.ts                                  MODIFY  — new columns + 2 new tables
src/db/migrations/XXXX_ticket_enhancements.sql    CREATE  — generated by drizzle-kit
src/lib/ticket-state-machine.ts                   CREATE
src/lib/ticket-audit.ts                           CREATE
src/lib/email-parser.ts                           CREATE
src/actions/support.ts                            MODIFY  — audit writes, state machine, macros CRUD
src/app/api/webhooks/email-inbound/route.ts       CREATE
src/app/api/cron/ticket-autoclose/route.ts        CREATE
src/app/api/cron/ticket-sla-check/route.ts        CREATE
src/app/api/tickets/[id]/presence/route.ts        CREATE
src/app/(main)/dashboard/support/tickets/[id]/page.tsx   MODIFY  — audit log UI, macro picker, collision banner
src/app/(main)/dashboard/settings/macros/page.tsx         CREATE
src/app/(main)/dashboard/settings/macros/_components/     CREATE
src/navigation/sidebar/sidebar-items.ts           MODIFY  — add macros under settings
messages/en.json + it.json                        MODIFY  — new keys for all above
```

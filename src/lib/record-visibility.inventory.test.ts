/**
 * Every person-facing read of a customer, or of what hangs off one, goes through the visibility
 * rules (src/lib/record-visibility.ts) — or is listed here with the reason it need not.
 *
 * ⚠️⚠️ A rule each function has to remember is one the next function would not have, and a list
 * that shows a colleague's customers looks exactly like a list that works. Read as source, like
 * the field-history and api-write-log inventories: every declaration in a server-actions file,
 * every dashboard page and every route that selects FROM one of these tables must name one of
 * the visibility helpers in its body.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const TABLES = [
  "leads",
  "contacts",
  "companies",
  "deals",
  "quotes",
  "orders",
  "contracts",
  "invoices",
  "tasks",
  "activities",
  "appointments",
  "documents",
];
const READS = new RegExp(`\\.from\\((?:${TABLES.join("|")})\\)|\\.query\\.(?:${TABLES.join("|")})\\.find`);
const HELPERS = /\b(?:visibleWhere|assertCanSee|recordScope|visibleIds|inVisible|canSeeRecord)\b/;

/**
 * Reads that need no visibility, and why. Keyed `file#declaration`, or `file` for a whole page or
 * route. ⚠️ An entry here is a decision: say who calls it and why it may see every row.
 */
const EXEMPT: Record<string, string> = {
  "src/actions/appointments.ts#removeOccurrences":
    "private; called only by cancelAppointment / deleteAppointment after assertCanSee on the appointment",
  "src/actions/appointments.ts#detachedFrom":
    "private; called only by cancelAppointment / deleteAppointment after assertCanSee on the appointment",
  "src/actions/tasks.ts#recalcParentProgress": "private; called only after a guarded write to a child task",
  "src/actions/tasks.ts#shiftDates":
    "private; propagateDateShift checks the root task, and its successors move because the dependency says so",
  "src/actions/today.ts#getTodayView":
    "the person's own agenda: tasks they own or are assigned, activities they own, appointments through the filtered getAppointments",
  "src/actions/next-actions.ts#getNextActions":
    "every query is narrowed to the person's own records; new leads also to their groups' and to nobody's, which visibleWhere('lead') shows them anyway",

  // Through a helper of their own file that applies the rules.
  "src/actions/crm.ts#listLeads": "listWhere ANDs visibleWhere into the list and its count",
  "src/actions/crm.ts#listContacts": "listWhere ANDs visibleWhere into the list and its count",
  "src/actions/crm.ts#listCompanies": "listWhere ANDs visibleWhere into the list and its count",
  "src/actions/crm.ts#checkLeadDuplicates": "maskHidden blanks a colleague's match through visibleIds",
  "src/actions/crm.ts#checkContactDuplicates": "maskHidden blanks a colleague's match through visibleIds",
  "src/actions/crm.ts#checkCompanyDuplicates": "maskHidden blanks a colleague's match through visibleIds",
  "src/actions/orders.ts#orderInvoiced": "private; called after assertCanSee on the order",
  "src/actions/orders.ts#recalcOrder": "private; called after assertCanSee on the order",
  "src/actions/invoices.ts#creditRoom": "private; called by guarded invoice actions or the admin-only issue",
  "src/actions/invoices.ts#orderIssueProblem": "private; called by guarded invoice actions or the admin-only issue",
  "src/actions/invoices.ts#depositsOf": "private; called by guarded invoice actions or the admin-only issue",
  "src/actions/invoices.ts#undeductedDeposits": "private; called by guarded invoice actions or the admin-only issue",

  // A quote is acted on by its owner or an administrator only: never wider than visibility.
  "src/actions/quotes.ts#createQuoteRevisionAction": "owner of the quote, or record:manageAny",
  "src/actions/quotes.ts#deleteQuoteAction": "owner of the quote, or record:manageAny",
  "src/actions/quotes.ts#sendQuoteEmailAction": "owner of the quote, or record:manageAny",
  "src/actions/quotes.ts#previewQuoteEmailAction": "owner of the quote, or record:manageAny",
  "src/actions/quotes.ts#requestApprovalAction": "owner of the quote, or record:manageAny",

  // Administrators see every record: these need nothing more than their capability.
  "src/actions/quotes.ts#approveQuoteAction": "quote:approve (admin)",
  "src/actions/quotes.ts#rejectQuoteAction": "quote:approve (admin)",
  "src/actions/orders.ts#deleteOrder": "order:delete (admin)",
  "src/actions/invoices.ts#issueInvoiceAction": "invoice:issue (admin)",
  "src/actions/bank.ts#getCompanyOpenItems": "bank:reconcile (admin)",
  "src/actions/billing.ts#getSubscriptionDetails": "billing administration: counts records against the plan",
  "src/actions/finance.ts#getFinanceDashboard": "settings:manage (admin)",
  "src/actions/pipeline.ts#updatePipelineStage": "pipeline:manage (admin): counts the deals in a stage",
  "src/actions/pipeline.ts#deletePipelineStage": "pipeline:manage (admin): counts the deals in a stage",
  "src/actions/pipeline.ts#deletePipelineAction": "pipeline:manage (admin): counts the deals in a pipeline",
  "src/app/api/reports/export/route.ts": "report:manage (admin)",

  // A number, not a customer.
  "src/actions/marketing.ts#getEligibleRecipientCounts":
    "how many a campaign can reach: campaigns and segments are the workspace's, not a salesperson's",
  "src/actions/price-lists.ts#getPriceList": "how many companies use the list, not which",
  "src/actions/pipeline-members.ts#getPipelineMembers": "colleagues who own deals, for the owners filter: no customer",

  // Not a customer list.
  "src/actions/support.ts#addTicketMessageAction":
    "tickets are the support desk's shared queue; it reads the ticket's own contact to write to them",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path.split("\\").join("/"));
  }
  return out;
}

const read = (file: string) => readFileSync(file, "utf8").split("\r\n").join("\n");

/** The top-level declarations of a module, each with its source up to the next one. */
function declarations(src: string): { name: string; body: string }[] {
  const re = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*=/gm;
  const starts = [...src.matchAll(re)].map((m) => ({ name: m[1] ?? m[2], at: m.index ?? 0 }));
  return starts.map((s, i) => ({ name: s.name, body: src.slice(s.at, starts[i + 1]?.at ?? src.length) }));
}

/** Server actions: one check per declaration. Pages and dashboard routes: one per file. */
function unguarded(): string[] {
  const missing: string[] = [];
  for (const file of walk("src/actions")) {
    const src = read(file);
    if (!src.trimStart().startsWith('"use server"')) continue;
    for (const d of declarations(src)) {
      const key = `${file}#${d.name}`;
      if (READS.test(d.body) && !HELPERS.test(d.body) && !(key in EXEMPT)) missing.push(key);
    }
  }
  const surfaces = [
    ...walk("src/app/(main)/dashboard").filter((f) => /\/(page|route)\.tsx?$/.test(f)),
    ...walk("src/app/api").filter(
      // The machine surfaces: keys, jobs, webhooks and public links see what their caller is
      // entitled to by other means (CLAUDE.md, "The import API" and "Scheduled work").
      (f) =>
        /\/route\.ts$/.test(f) &&
        !/^src\/app\/api\/(crm|cron|webhooks|quotes\/public|forms|booking|unsubscribe|track|calendar|admin)\//.test(f),
    ),
  ];
  for (const file of surfaces) {
    const src = read(file);
    if (READS.test(src) && !HELPERS.test(src) && !(file in EXEMPT)) missing.push(file);
  }
  return missing;
}

describe("⚠️⚠️ who sees which customer", () => {
  it("every person-facing read of a customer applies the visibility rules, or says why not", () => {
    expect(unguarded()).toEqual([]);
  });

  it("every exemption still names something that exists", () => {
    const stale = Object.keys(EXEMPT).filter((key) => {
      const [file, name] = key.split("#");
      try {
        const src = read(file);
        return name ? !declarations(src).some((d) => d.name === name) : false;
      } catch {
        return true;
      }
    });
    expect(stale).toEqual([]);
  });
});

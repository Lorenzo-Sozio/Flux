import { and, asc, eq, like, or, sql } from "drizzle-orm";

import { activities, companies, contacts, deals, leads, pipelineStages, tasks } from "@/db/schema";
import { resolvePipelineId } from "@/lib/pipelines";

/**
 * A handful of companies, people, deals, activities and tasks, so a new workspace has
 * something on every screen while somebody decides whether it is for them (§13.2) — and
 * one button that takes them all away again.
 *
 * ⚠️⚠️ Every row's id starts with `SAMPLE_PREFIX`, and that is the only thing removal reads.
 * A flag column would have needed a migration on eight tables; a prefix is on every row
 * already, cannot be edited from any form, and cannot be set by an import or the API, which
 * generate their own ids. What people add *to* a sample record (a note, a task, a file)
 * cascades with it; quotes, orders and invoices only lose the link.
 *
 * ⚠️ Addresses are on RFC 2606 domains (`example.com`), no one has marketing consent, and
 * nothing is inserted through the actions — so no automation fires, no sequence enrols, and
 * no campaign or reminder can reach a real person because of data nobody typed.
 *
 * ⚠️ Loaded only into a workspace with no deals or contacts of its own: mixed into real
 * figures it would sit in every report as if it had happened.
 */

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export const SAMPLE_PREFIX = "sample-";
const DAY = 86_400_000;

type Lang = "it" | "en";

const TEXT: Record<
  Lang,
  {
    companies: [string, string][];
    deals: string[];
    activities: string[];
    tasks: string[];
  }
> = {
  it: {
    companies: [
      ["Rossi Arredamenti Srl", "Arredamento"],
      ["Bianchi Logistica SpA", "Logistica"],
      ["Studio Verdi", "Consulenza"],
    ],
    deals: [
      "Arredo uffici sede di Milano",
      "Contratto trasporti 2027",
      "Consulenza avvio progetto",
      "Rinnovo showroom",
      "Magazzino nord",
      "Formazione del personale",
    ],
    activities: [
      "Chiamata introduttiva: interessati a un preventivo entro fine mese.",
      "Incontro in sede con il responsabile acquisti.",
      "Inviata la presentazione dei servizi.",
      "Richiamare dopo la riunione del consiglio.",
    ],
    tasks: ["Preparare il preventivo per Rossi", "Richiamare Bianchi Logistica", "Inviare il contratto a Studio Verdi"],
  },
  en: {
    companies: [
      ["Rossi Furniture Ltd", "Furniture"],
      ["Bianchi Logistics plc", "Logistics"],
      ["Verdi Consulting", "Consulting"],
    ],
    deals: [
      "Office fit-out, Milan branch",
      "Haulage contract 2027",
      "Project kick-off consulting",
      "Showroom refresh",
      "North warehouse",
      "Staff training",
    ],
    activities: [
      "Intro call: interested in a quote by the end of the month.",
      "Meeting on site with the purchasing manager.",
      "Sent the services presentation.",
      "Call back after the board meeting.",
    ],
    tasks: ["Prepare the quote for Rossi", "Call Bianchi Logistics back", "Send the contract to Verdi Consulting"],
  },
};

const PEOPLE: [string, string, string][] = [
  ["Mario", "Rossi", "mario.rossi@example.com"],
  ["Giulia", "Rossi", "giulia.rossi@example.com"],
  ["Luca", "Bianchi", "luca.bianchi@example.org"],
  ["Sara", "Conti", "sara.conti@example.org"],
  ["Paolo", "Verdi", "paolo.verdi@example.net"],
];

const LEADS: [string, string, string, string][] = [
  ["Elena", "Galli", "elena.galli@example.com", "Galli & Figli"],
  ["Marco", "Ferri", "marco.ferri@example.org", "Ferri Impianti"],
  ["Anna", "Moretti", "anna.moretti@example.net", "Moretti Design"],
];

const id = (kind: string, n: number) => `${SAMPLE_PREFIX}${kind}-${n}`;

/** Whether this workspace holds sample data now. */
export async function hasSampleData(db: AnyDb): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deals)
    .where(like(deals.id, `${SAMPLE_PREFIX}%`));
  return Number(row?.n ?? 0) > 0;
}

/** Whether the workspace has records of its own, which sample data must not be mixed into. */
async function hasOwnRecords(db: AnyDb): Promise<boolean> {
  const [row] = await db
    .execute(sql`
    select (exists (select 1 from ${deals} where ${deals.id} not like ${`${SAMPLE_PREFIX}%`})
         or exists (select 1 from ${contacts} where ${contacts.id} not like ${`${SAMPLE_PREFIX}%`})) as own`)
    .then((r: { rows: unknown[] }) => r.rows as { own: boolean }[]);
  return Boolean(row?.own);
}

export async function loadSampleData(
  db: AnyDb,
  input: { ownerId: string; locale: string },
  now = new Date(),
): Promise<{ ok: true } | { ok: false; reason: "notEmpty" | "alreadyLoaded" | "noStages" }> {
  if (await hasSampleData(db)) return { ok: false, reason: "alreadyLoaded" };
  if (await hasOwnRecords(db)) return { ok: false, reason: "notEmpty" };

  const stages: { id: string; isWon: boolean; isLost: boolean; defaultProbability: number | null }[] = await db
    .select({
      id: pipelineStages.id,
      isWon: pipelineStages.isWon,
      isLost: pipelineStages.isLost,
      defaultProbability: pipelineStages.defaultProbability,
    })
    .from(pipelineStages)
    // The first pipeline's: sample deals are new business.
    .where(eq(pipelineStages.pipelineId, await resolvePipelineId(db, null)))
    .orderBy(asc(pipelineStages.order));
  const open = stages.filter((s) => !s.isWon && !s.isLost);
  const won = stages.find((s) => s.isWon);
  const lost = stages.find((s) => s.isLost);
  if (open.length === 0) return { ok: false, reason: "noStages" };

  const text = TEXT[input.locale === "en" ? "en" : "it"];
  const owner = input.ownerId;
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  const ahead = (days: number) => new Date(now.getTime() + days * DAY);
  const stage = (n: number) => open[Math.min(n, open.length - 1)];

  await db.insert(companies).values(
    text.companies.map(([name, industry], i) => ({
      id: id("company", i + 1),
      name,
      industry,
      ownerId: owner,
      createdAt: ago(40 - i * 5),
    })),
  );
  const companyOf = [1, 1, 2, 2, 3];
  await db.insert(contacts).values(
    PEOPLE.map(([firstName, lastName, email], i) => ({
      id: id("contact", i + 1),
      firstName,
      lastName,
      email,
      companyId: id("company", companyOf[i]),
      ownerId: owner,
      marketingConsent: false,
      createdAt: ago(38 - i * 4),
    })),
  );
  await db.insert(leads).values(
    LEADS.map(([firstName, lastName, email, companyName], i) => ({
      id: id("lead", i + 1),
      firstName,
      lastName,
      email,
      companyName,
      status: i === 0 ? "contacting" : "new",
      source: "sample",
      ownerId: owner,
      marketingConsent: false,
      createdAt: ago(6 - i * 2),
    })),
  );

  const dealRows = [
    { n: 1, amount: 18000, stage: stage(0), company: 1, contact: 1, created: 12, closes: 30 },
    { n: 2, amount: 42000, stage: stage(1), company: 2, contact: 3, created: 25, closes: 20 },
    { n: 3, amount: 7500, stage: stage(2), company: 3, contact: 5, created: 9, closes: 45 },
    { n: 4, amount: 12000, stage: stage(3), company: 1, contact: 2, created: 33, closes: 10 },
  ].map((d) => ({
    id: id("deal", d.n),
    name: text.deals[d.n - 1],
    amount: String(d.amount),
    currency: "EUR",
    stageId: d.stage.id,
    probability: d.stage.defaultProbability,
    status: "open",
    companyId: id("company", d.company),
    contactId: id("contact", d.contact),
    ownerId: owner,
    expectedCloseDate: ahead(d.closes),
    createdAt: ago(d.created),
  }));
  // One won this month and one lost, so the win rate and the scorecard have something to say.
  if (won) {
    dealRows.push({
      ...dealRows[0],
      id: id("deal", 5),
      name: text.deals[4],
      amount: "9500",
      stageId: won.id,
      probability: 100,
      status: "won",
      companyId: id("company", 2),
      contactId: id("contact", 4),
      expectedCloseDate: ago(2),
      createdAt: ago(35),
      closedAt: ago(2),
    } as (typeof dealRows)[number]);
  }
  if (lost) {
    dealRows.push({
      ...dealRows[0],
      id: id("deal", 6),
      name: text.deals[5],
      amount: "4000",
      stageId: lost.id,
      probability: 0,
      status: "lost",
      companyId: id("company", 3),
      contactId: id("contact", 5),
      expectedCloseDate: ago(5),
      createdAt: ago(28),
      closedAt: ago(5),
    } as (typeof dealRows)[number]);
  }
  await db.insert(deals).values(dealRows);

  await db.insert(activities).values([
    {
      id: id("activity", 1),
      type: "call",
      content: text.activities[0],
      date: ago(10),
      contactId: id("contact", 1),
      dealId: id("deal", 1),
      companyId: id("company", 1),
      ownerId: owner,
      outcome: "reached",
    },
    {
      id: id("activity", 2),
      type: "meeting",
      content: text.activities[1],
      date: ago(18),
      contactId: id("contact", 3),
      dealId: id("deal", 2),
      companyId: id("company", 2),
      ownerId: owner,
    },
    {
      id: id("activity", 3),
      type: "note",
      content: text.activities[2],
      date: ago(7),
      contactId: id("contact", 5),
      dealId: id("deal", 3),
      companyId: id("company", 3),
      ownerId: owner,
    },
    {
      id: id("activity", 4),
      type: "call",
      content: text.activities[3],
      date: ago(1),
      leadId: id("lead", 1),
      ownerId: owner,
      outcome: "no_answer",
    },
  ]);
  await db.insert(tasks).values([
    // One due today, one overdue, one next week: the agenda and the work list both have a row.
    {
      id: id("task", 1),
      title: text.tasks[0],
      type: "email",
      status: "todo",
      dueDate: now,
      allDay: true,
      dealId: id("deal", 1),
      contactId: id("contact", 1),
      ownerId: owner,
      assigneeId: owner,
    },
    {
      id: id("task", 2),
      title: text.tasks[1],
      type: "call",
      status: "todo",
      dueDate: ago(2),
      allDay: true,
      dealId: id("deal", 2),
      contactId: id("contact", 3),
      ownerId: owner,
      assigneeId: owner,
    },
    {
      id: id("task", 3),
      title: text.tasks[2],
      type: "todo",
      status: "todo",
      dueDate: ahead(6),
      allDay: true,
      dealId: id("deal", 3),
      contactId: id("contact", 5),
      ownerId: owner,
      assigneeId: owner,
    },
  ]);
  return { ok: true };
}

/**
 * Takes every sample row away, children first. What people added to a sample record goes
 * with it (cascade); a document of their own that pointed at one keeps existing without
 * the link.
 */
export async function removeSampleData(db: AnyDb): Promise<void> {
  const prefix = `${SAMPLE_PREFIX}%`;
  await db.delete(tasks).where(like(tasks.id, prefix));
  await db.delete(activities).where(like(activities.id, prefix));
  await db.delete(deals).where(like(deals.id, prefix));
  await db.delete(leads).where(like(leads.id, prefix));
  await db.delete(contacts).where(like(contacts.id, prefix));
  await db.delete(companies).where(like(companies.id, prefix));
}

/** Records that point at sample ones from outside, for the confirmation to be honest about. */
export async function sampleDependents(db: AnyDb): Promise<number> {
  const prefix = `${SAMPLE_PREFIX}%`;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(activities)
    .where(
      and(
        sql`${activities.id} not like ${prefix}`,
        or(
          like(activities.dealId, prefix),
          like(activities.contactId, prefix),
          like(activities.companyId, prefix),
          like(activities.leadId, prefix),
        ),
      ),
    );
  const [taskRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        sql`${tasks.id} not like ${prefix}`,
        or(
          like(tasks.dealId, prefix),
          like(tasks.contactId, prefix),
          like(tasks.companyId, prefix),
          like(tasks.leadId, prefix),
        ),
      ),
    );
  return Number(row?.n ?? 0) + Number(taskRow?.n ?? 0);
}

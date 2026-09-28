/**
 * ⚠️⚠️ Notifications written before their texts had keys are given one by migration
 * 0057_in_their_language, so the bell composes them in the reader's language.
 *
 * Until 27 September 2026 the product stored finished English sentences, and the bell can
 * only translate a row that carries a key. Each case here is a sentence the old code wrote,
 * inserted as it was, and read back in Italian the way the bell reads it.
 */
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { createTranslator } from "next-intl";
import { beforeAll, describe, expect, it } from "vitest";

import itMessages from "../../messages/it.json";
import { applyTenantMigrations } from "./migrate-tenant";
import { tenantMigrations } from "./migrations-tenant.generated";
import { notifications, users } from "./schema";

const pg = drizzle(new PGlite());
const THIS = "0057_in_their_language";

/** The bell's composition: the key and values, in the reader's language. */
const tn = createTranslator({
  locale: "it",
  messages: itMessages,
  namespace: "notificationTexts",
} as never) as unknown as (k: string, v?: Record<string, string | number>) => string;

const LEGACY: { id: string; type: string; title: string; message: string | null }[] = [
  {
    id: "due",
    type: "task_due",
    title: 'Task due today: "Ordinare i lauri"',
    message: "This task is due today. Don't forget to complete it.",
  },
  {
    id: "call",
    type: "task_due",
    title: 'Call today: "chiamato ma non ha risposto"',
    message: "You have a call scheduled today.",
  },
  { id: "soon", type: "task_due", title: 'Upcoming meeting: "Sopralluogo"', message: "Scheduled for 10:30" },
  {
    id: "late",
    type: "task_due",
    title: 'Task "Posa prato" is overdue',
    message: "2 dependent task(s) are at risk. Consider rescheduling.",
  },
  {
    id: "lead",
    type: "lead_assigned",
    title: "Lead assigned to you",
    message: "Mario Rossi has been assigned to you.",
  },
  { id: "won", type: "deal_won", title: "Deal won! 🏆", message: '"Giardino Villa Serena" has been marked as won.' },
  {
    id: "back",
    type: "quote_rejected",
    title: "Quote sent back",
    message: "Quote P-2026-004 was not approved. Reason: Sconto alto",
  },
  { id: "order", type: "order_created", title: "New order ORD-12", message: "€ 1.220,00 — 3 lines." },
  { id: "sla", type: "sla_breach", title: "SLA missed — TKT-7", message: "Stampante guasta" },
  {
    id: "renew",
    type: "contract_renewal",
    title: 'Contract "Manutenzione aree verdi" is due for a decision',
    message: "It renews itself on 2026-11-28 unless notice is given by 2026-09-28.",
  },
  // Not a sentence the product wrote: an automation's own text stays as it was.
  { id: "own", type: "system", title: "Richiamare il cliente", message: "Scritto da una regola" },
  // Its sentence never said who completed it, and the keyed one does.
  { id: "done", type: "task_completed", title: "Task completed", message: '"Posa prato" was marked as done.' },
];

beforeAll(async () => {
  // Only what came before it: the migrator applies what is newer than the newest recorded,
  // so a later migration applied first would make this one look done.
  const self = tenantMigrations.find((m) => m.tag === THIS);
  if (!self) throw new Error(`${THIS} is not embedded`);
  await applyTenantMigrations(
    pg as never,
    tenantMigrations.filter((m) => m.folderMillis < self.folderMillis),
  );
  await pg.insert(users).values({ id: "anna", email: "anna@example.com", name: "Anna" });
  await pg.insert(notifications).values(LEGACY.map((n) => ({ ...n, userId: "anna" })));
  await applyTenantMigrations(pg as never);
});

async function read(id: string) {
  const [row] = await pg.select().from(notifications).where(eq(notifications.id, id));
  return row;
}

describe(`⚠️⚠️ ${THIS}`, () => {
  it.each([
    ["due", "Scade oggi: «Ordinare i lauri»"],
    ["call", "Chiamata oggi: «chiamato ma non ha risposto»"],
    ["soon", "Riunione in arrivo: «Sopralluogo»"],
    ["late", "«Posa prato» è in ritardo"],
    ["lead", "Ti è stato assegnato un lead"],
    ["won", "Trattativa vinta! 🏆"],
    ["back", "Preventivo rimandato indietro"],
    ["order", "Nuovo ordine ORD-12"],
    ["sla", "SLA mancato — TKT-7"],
    ["renew", "Il contratto «Manutenzione aree verdi» richiede una decisione"],
  ])("gives %s its key, and the bell reads it in Italian", async (id, title) => {
    const row = await read(id);
    expect(row.titleKey).not.toBeNull();
    const composed = tn(`${row.titleKey}.title`, row.params ?? {});
    expect(composed).toBe(title);
    // Every value the Italian message needs is there: a missing one throws.
    expect(() => tn(`${row.titleKey}.message`, row.params ?? {})).not.toThrow();
  });

  it("reads the values out exactly", async () => {
    expect((await read("call")).params).toEqual({ kind: "call", description: "chiamato ma non ha risposto" });
    expect((await read("late")).params).toEqual({ title: "Posa prato", count: 2 });
    expect((await read("back")).params).toEqual({ number: "P-2026-004", hasReason: "yes", reason: "Sconto alto" });
    expect((await read("order")).params).toEqual({ number: "ORD-12", total: "€ 1.220,00", lines: 3 });
    expect((await read("renew")).params).toMatchObject({
      title: "Manutenzione aree verdi",
      autoRenew: "yes",
      renewsOn: "2026-11-28",
      deadline: "2026-09-28",
    });
  });

  it("leaves text a person wrote, and a sentence it cannot complete, as they were", async () => {
    expect((await read("own")).titleKey).toBeNull();
    expect((await read("done")).titleKey).toBeNull();
  });
});

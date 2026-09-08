"use server";

import { and, gte, lte, sql } from "drizzle-orm";

import { contacts, orders } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { SORGENTE_ASSISTENTE } from "@/lib/order-source";
import { getDb } from "@/lib/tenant-context";

/**
 * What the assistant brought into this CRM — counted from this CRM's own rows.
 *
 * ## Why it reads nothing from the assistant
 *
 * The two products have to stand on their own. This workspace keeps working with the
 * integration switched off, disconnected, or never bought: the numbers here come from
 * `contact.source` and `order.source`, columns of this database, and with no assistant
 * they simply stop growing. Nothing on this page waits on a request to another system.
 *
 * ⚠️ **And it is deliberately NOT the same number the assistant reports.** Over there the
 * unit is a *process it ran*; here it is a *record that landed in the CRM*. Two counts of
 * the same month will not match, and making them match would mean one of the two products
 * asking the other what to believe — which is exactly the coupling the boundary exists to
 * prevent. Each says what it counted.
 *
 * ## ⚠️⚠️ Null is not "a person"
 *
 * Orders written before the `source` column existed carry no answer. Counting them as
 * manual would invent a number for a period this database cannot know, so they are
 * reported separately as *not recorded* — and the honest total of "how many were the
 * assistant's" is only the period since the column exists.
 */
export interface ContributoAssistente {
  /** Contacts this workspace has, whose record was created by the assistant. */
  contattiDallAssistente: number;
  /** All contacts, for the proportion. Without it a bare number says nothing. */
  contattiTotali: number;
  /** Orders in the period taken by the assistant. */
  ordiniDallAssistente: number;
  /** Orders in the period entered by a person here. */
  ordiniDaPersona: number;
  /**
   * Orders in the period with no answer: written before the column existed.
   *
   * ⚠️ Reported, not hidden and not folded into either side. A screen that dropped them
   * would show a total lower than the truth **and plausible**, which is the worst way to
   * be wrong because nobody sees it.
   */
  ordiniNonRegistrati: number;
  /** Money on the assistant's orders in the period, as a string: it is `numeric`. */
  incassoDallAssistente: string;
}

/**
 * The period is a whole month, given as the first and last day.
 *
 * ⚠️ Both ends inclusive, and `orderDate` is the column: an order is of the day it was
 * placed, not of the day somebody last touched the row.
 */
export async function contributoDellAssistente(da: Date, a: Date): Promise<ContributoAssistente> {
  await requireCapability("report:read");
  const db = await getDb();

  const [perContatti] = await db
    .select({
      totali: sql<number>`count(*)::int`,
      assistente: sql<number>`count(*) filter (where ${contacts.source} = ${SORGENTE_ASSISTENTE})::int`,
    })
    .from(contacts);

  const [perOrdini] = await db
    .select({
      assistente: sql<number>`count(*) filter (where ${orders.source} = ${SORGENTE_ASSISTENTE})::int`,
      // ⚠️ `is not null and <> 'assistant'`, not `<> 'assistant'` alone: in SQL a
      // comparison with null is null, not true, so the second form would silently drop
      // every unrecorded row into nowhere instead of into its own count.
      persona: sql<number>`count(*) filter (where ${orders.source} is not null and ${orders.source} <> ${SORGENTE_ASSISTENTE})::int`,
      nonRegistrati: sql<number>`count(*) filter (where ${orders.source} is null)::int`,
      incasso: sql<string>`coalesce(sum(case when ${orders.source} = ${SORGENTE_ASSISTENTE} then cast(${orders.totalAmount} as numeric) end), 0)::text`,
    })
    .from(orders)
    .where(and(gte(orders.orderDate, da), lte(orders.orderDate, a)));

  return {
    contattiDallAssistente: perContatti?.assistente ?? 0,
    contattiTotali: perContatti?.totali ?? 0,
    ordiniDallAssistente: perOrdini?.assistente ?? 0,
    ordiniDaPersona: perOrdini?.persona ?? 0,
    ordiniNonRegistrati: perOrdini?.nonRegistrati ?? 0,
    incassoDallAssistente: perOrdini?.incasso ?? "0",
  };
}

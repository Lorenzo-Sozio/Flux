"use server";

import { and, gte, lte, sql } from "drizzle-orm";

import { apiWriteLog } from "@/db/schema";
import { requireCapability } from "@/lib/auth-guard";
import { getDb } from "@/lib/tenant-context";

/**
 * What an integration has been doing in this CRM.
 *
 * ## Why it is not a count of orders
 *
 * A first version of this screen counted orders and the contacts created beside them. That
 * was one of the seven things the assistant does here — it also files leads, writes notes
 * on people's timelines, logs activities, fills in custom fields, closes deals and honours
 * opt-outs and erasures — and it counted the *side effect* rather than the work: an
 * assistant that spent a month qualifying leads and never took an order showed as having
 * done nothing at all.
 *
 * Worse, it read the answer out of `source`, which means *where the customer came from*.
 * Two questions in one column: the first workspace to use it for its real meaning would
 * have made this page lie, quietly and plausibly.
 *
 * ## It grows on its own
 *
 * The grouping is whatever the routes wrote, not a list kept here. The day the engine
 * learns an eighth verb and a new route records it, that verb appears on this page without
 * anybody remembering to add it — which is the only way a report of somebody else's
 * behaviour stays true.
 *
 * ## ⚠️⚠️ What this number does NOT say
 *
 * It counts writes **through the API**, and nothing else. Work people do in this interface
 * does not pass through those routes and is invisible here, so this is not a comparison
 * between an assistant and a team, and presenting it as one would be a lie of framing
 * rather than of arithmetic. The screen says so beside the figures.
 *
 * ⚠️ And `via` distinguishes a person from an integration, **not** one integration from
 * another: an API key identifies a workspace, not a caller. With two integrations
 * connected, these are the two of them together.
 *
 * ## The independence this page keeps
 *
 * Nothing here asks the assistant anything. The rows are this database's own, written as
 * the requests landed, so a workspace that has never connected an assistant opens the page
 * and sees nothing — which is true, not a fault — and one that disconnects it keeps every
 * figure it had.
 */
export interface VoceAttivita {
  /** What was written, in the CRM's own words: `lead`, `note`, `order`… */
  entity: string;
  /** How many requests. A batch of five hundred is one. */
  richieste: number;
  /** How many rows those requests wrote. */
  righe: number;
  /** The most recent one, so a silence has a date on it. */
  ultima: Date | null;
}

export interface AttivitaAssistente {
  /** What integrations wrote, grouped, biggest first. */
  voci: VoceAttivita[];
  /**
   * Requests made through the API by a signed-in person.
   *
   * ⚠️ Not "what people did": almost everything people do here goes through the interface
   * and never touches these routes. It is here because a number that is *not* an
   * integration's, filed among an integration's, would overstate it.
   */
  richiesteDaPersona: number;
}

/** `session` and `apikey` are what `authenticateApiRequest` returns; nothing else is written. */
const DA_INTEGRAZIONE = "apikey";
const DA_PERSONA = "session";

/**
 * The period is given as its two ends, both inclusive.
 *
 * ⚠️ The last instant of the last day, not its midnight: `created_at` carries a time, and a
 * range that stops at 00:00 loses everything the assistant did on the final day — a whole
 * day missing, and the total still looks plausible.
 */
export async function attivitaDellAssistente(da: Date, a: Date): Promise<AttivitaAssistente> {
  await requireCapability("report:read");
  const db = await getDb();

  const periodo = and(gte(apiWriteLog.createdAt, da), lte(apiWriteLog.createdAt, a));

  const righe = await db
    .select({
      entity: apiWriteLog.entity,
      richieste: sql<number>`count(*)::int`,
      // ⚠️ `sum` of an empty group is null, not zero, and a null landing in a template
      // renders as nothing at all rather than as a 0 somebody would question.
      righe: sql<number>`coalesce(sum(${apiWriteLog.rows}), 0)::int`,
      ultima: sql<Date>`max(${apiWriteLog.createdAt})`,
    })
    .from(apiWriteLog)
    .where(and(periodo, sql`${apiWriteLog.via} = ${DA_INTEGRAZIONE}`))
    .groupBy(apiWriteLog.entity)
    .orderBy(sql`sum(${apiWriteLog.rows}) desc`);

  const [persone] = await db
    .select({ richieste: sql<number>`count(*)::int` })
    .from(apiWriteLog)
    .where(and(periodo, sql`${apiWriteLog.via} = ${DA_PERSONA}`));

  return {
    voci: righe.map((r) => ({
      entity: r.entity,
      richieste: r.richieste,
      righe: r.righe,
      ultima: r.ultima ? new Date(r.ultima) : null,
    })),
    richiesteDaPersona: persone?.richieste ?? 0,
  };
}

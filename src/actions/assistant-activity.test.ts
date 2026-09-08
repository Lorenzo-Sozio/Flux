/**
 * What the assistant has been doing, and the four ways this report could lie.
 *
 * The arithmetic is Postgres's job. What is pinned here is the shape of the question,
 * because each of these, if it went wrong, would produce a figure that is **plausible and
 * false** — the only kind nobody catches:
 *
 * 1. counting a person's work as an integration's, which is the whole claim of the page;
 * 2. reading the grouping from a list kept in the code, so a verb the engine has just
 *    learned quietly does not exist;
 * 3. losing the last day of the month to a range that stops at midnight;
 * 4. asking the assistant's database instead of this one, which would make the page fail
 *    for every workspace that has not bought it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** What the action asked the database, captured verbatim. */
const interrogazioni: { selezione: Record<string, unknown>; dove: unknown; raggruppa: unknown }[] = [];
let risposta: Record<string, unknown>[] = [];

vi.mock("@/lib/tenant-context", () => ({
  getDb: async () => ({
    select: (selezione: Record<string, unknown>) => ({
      from: () => {
        // ⚠️ **One entry per query, completed as the chain goes on.** Recording again in
        // `where` would leave two entries for the grouped query — one bare and one full —
        // and a test reading the first would be proving a query the code never makes.
        const voce = { selezione, dove: undefined as unknown, raggruppa: undefined as unknown };
        interrogazioni.push(voce);
        const coda = {
          groupBy: (raggruppa: unknown) => {
            voce.raggruppa = raggruppa;
            return Object.assign(Promise.resolve(risposta), { orderBy: () => Promise.resolve(risposta) });
          },
        };
        return Object.assign(Promise.resolve(risposta), {
          where: (dove: unknown) => {
            voce.dove = dove;
            return Object.assign(Promise.resolve(risposta), coda);
          },
        });
      },
    }),
  }),
}));
vi.mock("@/lib/auth-guard", () => ({ requireCapability: async () => undefined }));
vi.mock("@/db/schema", () => ({
  apiWriteLog: {
    entity: "api_write_log.entity",
    rows: "api_write_log.rows",
    via: "api_write_log.via",
    createdAt: "api_write_log.created_at",
  },
}));
vi.mock("drizzle-orm", () => ({
  and: (...p: unknown[]) => ({ and: p }),
  gte: (c: unknown, v: unknown) => ({ gte: [c, v] }),
  lte: (c: unknown, v: unknown) => ({ lte: [c, v] }),
  // The template is kept as text: it is what these tests look at.
  sql: (pezzi: TemplateStringsArray, ...valori: unknown[]) =>
    pezzi.reduce((acc, p, i) => acc + p + (i < valori.length ? String(valori[i]) : ""), ""),
}));

const { attivitaDellAssistente } = await import("@/actions/assistant-activity");

const PRIMO = new Date(2026, 8, 1);
const ULTIMO = new Date(2026, 8, 30, 23, 59, 59, 999);

beforeEach(() => {
  interrogazioni.length = 0;
  risposta = [];
});

describe("che cosa ha fatto l'assistente", () => {
  it("⚠️⚠️ conta solo ciò che ha scritto un'integrazione", async () => {
    await attivitaDellAssistente(PRIMO, ULTIMO);

    // The claim of the whole page is «this was done unattended». Counting a signed-in
    // person's API calls among them would overstate exactly the number being sold.
    expect(JSON.stringify(interrogazioni[0].dove)).toContain("apikey");
  });

  it("⚠️ tiene a parte quello che ha scritto una persona", async () => {
    await attivitaDellAssistente(PRIMO, ULTIMO);

    expect(interrogazioni).toHaveLength(2);
    expect(JSON.stringify(interrogazioni[1].dove)).toContain("session");
    // ⚠️ Two separate conditions, not one query filtered in the page: `session` rows must
    // never be able to fall into the first count by accident.
    expect(JSON.stringify(interrogazioni[0].dove)).not.toContain("session");
  });

  it("⚠️⚠️ raggruppa per quello che è stato scritto, senza un elenco in codice", async () => {
    await attivitaDellAssistente(PRIMO, ULTIMO);

    // The day the engine learns an eighth verb, it appears on the page by itself. A list of
    // known entities here would silently drop it, and a missing line is invisible.
    expect(interrogazioni[0].raggruppa).toBe("api_write_log.entity");
  });

  it("⚠️ il periodo è su quando la scrittura è avvenuta", async () => {
    await attivitaDellAssistente(PRIMO, ULTIMO);

    const dove = JSON.stringify(interrogazioni[0].dove);
    expect(dove).toContain("api_write_log.created_at");
    // Both ends, and the far one is the last instant of the last day: the action is given
    // the range, and a caller that hands it a midnight loses a whole day of work.
    expect(dove).toContain(PRIMO.toISOString());
    expect(dove).toContain(ULTIMO.toISOString());
  });

  it("una voce senza scritture non diventa una data vuota", async () => {
    risposta = [{ entity: "lead", richieste: 3, righe: 12, ultima: null }];

    const { voci } = await attivitaDellAssistente(PRIMO, ULTIMO);

    expect(voci[0]).toEqual({ entity: "lead", richieste: 3, righe: 12, ultima: null });
  });

  it("uno spazio di lavoro senza assistente non è un guasto", async () => {
    risposta = [];

    const attivita = await attivitaDellAssistente(PRIMO, ULTIMO);

    // Nothing connected, nothing written: the page shows an empty month, and does not
    // reach out to another product to check.
    expect(attivita.voci).toEqual([]);
    expect(attivita.richiesteDaPersona).toBe(0);
  });
});

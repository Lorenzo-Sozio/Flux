/**
 * What the assistant brought in, and the three ways this count could lie.
 *
 * The numbers themselves are Postgres's job. What is pinned here is the shape of the
 * question — because each of these three, if it went wrong, would produce a figure that is
 * **plausible and false**, which is the only kind nobody catches:
 *
 * 1. an order with no recorded provenance counted as a person's;
 * 2. the period applied to the wrong column, so a month's takings move when a row is
 *    edited;
 * 3. the report reaching for the assistant's database instead of this one, which would
 *    make the page fail for every workspace that has not bought it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** What the action asked the database, captured verbatim. */
const interrogazioni: { selezione: Record<string, unknown>; da: unknown; dove: unknown }[] = [];
let risposta: Record<string, unknown>[] = [];

vi.mock("@/lib/tenant-context", () => ({
  getDb: async () => ({
    select: (selezione: Record<string, unknown>) => ({
      from: (da: unknown) => {
        // ⚠️ **Una riga per interrogazione, e `where` la completa invece di aggiungerne
        // una seconda.** Registrando anche in `where` ci sarebbero due righe per
        // l'interrogazione con il periodo — una senza e una con — e un test che guardasse
        // la prima proverebbe una query che il codice non fa.
        const voce = { selezione, da, dove: undefined as unknown };
        interrogazioni.push(voce);
        return Object.assign(Promise.resolve(risposta), {
          where: (dove: unknown) => {
            voce.dove = dove;
            return Promise.resolve(risposta);
          },
        });
      },
    }),
  }),
}));
vi.mock("@/lib/auth-guard", () => ({ requireCapability: async () => undefined }));
vi.mock("@/db/schema", () => ({
  contacts: { source: "contact.source" },
  orders: { source: "order.source", orderDate: "order.order_date", totalAmount: "order.total_amount" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...p: unknown[]) => ({ and: p }),
  gte: (c: unknown, v: unknown) => ({ gte: [c, v] }),
  lte: (c: unknown, v: unknown) => ({ lte: [c, v] }),
  // Il template si tiene come testo: è ciò su cui questi test guardano.
  sql: (pezzi: TemplateStringsArray, ...valori: unknown[]) =>
    pezzi.reduce((acc, p, i) => acc + p + (i < valori.length ? String(valori[i]) : ""), ""),
}));

const { contributoDellAssistente, SORGENTE_ASSISTENTE } = await import("@/actions/assistant-contribution");

beforeEach(() => {
  interrogazioni.length = 0;
  risposta = [{ totali: 0, assistente: 0, persona: 0, nonRegistrati: 0, incasso: "0" }];
});

const PRIMO = new Date(2026, 8, 1);
const ULTIMO = new Date(2026, 8, 30, 23, 59, 59, 999);

describe("il contributo dell'assistente", () => {
  it("conta gli ordini SENZA provenienza a parte, e non fra quelli di una persona", async () => {
    // ⚠️⚠️ La riga che conta. In SQL un confronto con `null` vale `null`, non `true`:
    // scritto `<> 'assistant'` e basta, ogni ordine scritto prima che la colonna esistesse
    // sparirebbe da entrambi i conti — e il totale del mese sarebbe più basso del vero
    // **e plausibile**. Scritto invece senza il ramo `is null`, quegli stessi ordini
    // verrebbero attribuiti a una persona che non li ha inseriti.
    await contributoDellAssistente(PRIMO, ULTIMO);

    const ordini = interrogazioni[1];
    expect(String(ordini.selezione.persona)).toContain("is not null");
    expect(String(ordini.selezione.nonRegistrati)).toContain("is null");
  });

  it("il periodo si applica alla data dell'ORDINE, non a quando la riga è stata toccata", async () => {
    // ⚠️ Un ordine è del giorno in cui è stato fatto. Sulla data di aggiornamento, il
    // fatturato di settembre cambierebbe a dicembre perché qualcuno ha corretto una riga.
    await contributoDellAssistente(PRIMO, ULTIMO);

    expect(JSON.stringify(interrogazioni[1].dove)).toContain("order.order_date");
    expect(JSON.stringify(interrogazioni[1].dove)).not.toContain("updated_at");
  });

  it("i contatti si contano SENZA periodo, e la pagina lo dice", async () => {
    // Una scheda si crea una volta sola: filtrarla per mese mostrerebbe zero a ogni
    // primo del mese su una rubrica piena, che si legge come un guasto.
    await contributoDellAssistente(PRIMO, ULTIMO);

    expect(interrogazioni[0].dove).toBeUndefined();
    expect(interrogazioni[0].da).toEqual({ source: "contact.source" });
  });

  it("legge SOLO questo database: nessuna chiamata all'assistente", async () => {
    // ⚠️⚠️ È la garanzia che tiene i due prodotti indipendenti. Una `fetch` qui
    // renderebbe questa pagina rotta per ogni workspace che l'assistente non ce l'ha —
    // cioè per la maggioranza — e il guasto comparirebbe solo in produzione.
    const rete = vi.spyOn(globalThis, "fetch");

    await contributoDellAssistente(PRIMO, ULTIMO);

    expect(rete).not.toHaveBeenCalled();
    rete.mockRestore();
  });

  it("la parola della provenienza è UNA sola, condivisa da chi scrive e da chi conta", async () => {
    // Scritta due volte — «assistant» nella rotta e «assistant» qui — diventerebbe due
    // parole il giorno in cui una delle due cambia, e il conto tornerebbe a zero senza
    // che nulla lo dica.
    await contributoDellAssistente(PRIMO, ULTIMO);

    expect(SORGENTE_ASSISTENTE).toBe("assistant");
    expect(String(interrogazioni[1].selezione.assistente)).toContain(SORGENTE_ASSISTENTE);
  });

  it("un database vuoto restituisce zeri, non `undefined`", async () => {
    // Una riga assente e uno zero si leggono uguali a schermo se il primo diventa «NaN»:
    // il caso è quello di ogni workspace nuovo, cioè il più comune di tutti.
    risposta = [];

    const c = await contributoDellAssistente(PRIMO, ULTIMO);

    expect(c).toEqual({
      contattiDallAssistente: 0,
      contattiTotali: 0,
      ordiniDallAssistente: 0,
      ordiniDaPersona: 0,
      ordiniNonRegistrati: 0,
      incassoDallAssistente: "0",
    });
  });
});

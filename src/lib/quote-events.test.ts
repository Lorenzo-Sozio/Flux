/**
 * L'evento che dice a un'integrazione che il preventivo e' partito.
 *
 * ⚠️⚠️ Prima di questo file non veniva emesso niente quando un preventivo passava a
 * «inviato»: un assistente in attesa di consegnare quel documento avrebbe aspettato per
 * sempre, e nulla sarebbe fallito. E' la forma di guasto peggiore, perche' il titolare
 * crede di aver mandato e il cliente non sa che esiste.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const emessi: { evento: string; carico: Record<string, unknown>; origin: unknown }[] = [];
let contatto: Record<string, unknown> | null = null;

vi.mock("@/actions/webhooks", () => ({
  dispatchWebhook: async (evento: string, carico: Record<string, unknown>, origin: unknown) => {
    emessi.push({ evento, carico, origin });
  },
}));
vi.mock("@/db/schema", () => ({ contacts: { id: "id" }, quotes: {} }));
vi.mock("drizzle-orm", () => ({ eq: () => "eq" }));
vi.mock("@/lib/tenant-context", () => ({
  getDb: async () => ({ query: { contacts: { findFirst: async () => contatto } } }),
}));

const { announceQuoteDecision, announceQuoteSent, hasAlreadyLeft } = await import("@/lib/quote-events");

// biome-ignore lint/suspicious/noExplicitAny: a row shape the test does not need in full
const PREVENTIVO: any = {
  id: "q1",
  quoteNumber: "PR-2026-014",
  version: 2,
  contactId: "c1",
  publicToken: "6f1c0b2e-1111-2222-3333-444455556666",
};

const BASE = process.env.NEXTAUTH_URL;

beforeEach(() => {
  emessi.length = 0;
  contatto = { email: "mario@example.it", phone: "+393330000001" };
  process.env.NEXTAUTH_URL = "https://flux.example.test";
});
afterEach(() => {
  if (BASE === undefined) delete process.env.NEXTAUTH_URL;
  else process.env.NEXTAUTH_URL = BASE;
});

describe("il preventivo che parte", () => {
  it("⚠️⚠️ porta un indirizzo che il destinatario puo' davvero aprire", async () => {
    await announceQuoteSent(PREVENTIVO, "u7");

    expect(emessi).toHaveLength(1);
    expect(emessi[0].evento).toBe("quote.sent");
    // La pagina HTML arriverebbe al cliente etichettata come PDF e si aprirebbe come
    // altro: e' la rotta che rende il documento a chi ha il token.
    expect(emessi[0].carico.url).toBe(
      "https://flux.example.test/api/quotes/q1/pdf?token=6f1c0b2e-1111-2222-3333-444455556666",
    );
  });

  it("⚠️⚠️ senza indirizzo di base NON inventa un localhost", async () => {
    // Un predefinito qui non fallirebbe: manderebbe a un cliente vero il link a una
    // macchina che non e' la sua. Una consegna riuscita verso il posto sbagliato.
    delete process.env.NEXTAUTH_URL;

    await announceQuoteSent(PREVENTIVO, "u7");

    expect(emessi).toHaveLength(1);
    expect(emessi[0].carico.url).toBeUndefined();
    expect(JSON.stringify(emessi[0].carico)).not.toContain("localhost");
  });

  it("porta il recapito, che e' l'unica cosa che i due sistemi hanno in comune", async () => {
    await announceQuoteSent(PREVENTIVO, "u7");

    expect(emessi[0].carico.email).toBe("mario@example.it");
    expect(emessi[0].carico.phone).toBe("+393330000001");
  });

  it("⚠️ dichiara l'origine «persona», perche' qualcuno ha premuto invia", async () => {
    await announceQuoteSent(PREVENTIVO, "u7");

    expect(emessi[0].origin).toEqual({ via: "user", actor: "u7" });
  });

  it("da' un nome al documento", async () => {
    // Senza, l'allegato arriva senza nome, che somiglia molto a qualcosa da non aprire.
    await announceQuoteSent(PREVENTIVO, "u7");

    expect(emessi[0].carico.nome).toBe("Preventivo PR-2026-014.pdf");
  });

  it("parte anche se il preventivo non ha un contatto collegato", async () => {
    contatto = null;

    await announceQuoteSent({ ...PREVENTIVO, contactId: null }, "u7");

    expect(emessi).toHaveLength(1);
    expect(emessi[0].carico.email).toBeUndefined();
  });
});

describe("la risposta del cliente", () => {
  it("⚠️⚠️ viene annunciata, ed e' cio' che un assistente non puo' scoprire da solo", async () => {
    await announceQuoteDecision(PREVENTIVO, "accepted", null);

    expect(emessi).toHaveLength(1);
    expect(emessi[0].evento).toBe("quote.accepted");
  });

  it("annuncia anche il NO, non solo il si'", async () => {
    // Chi sente parlare solo delle accettazioni deve trattare il silenzio come un rifiuto,
    // e il silenzio significa anche una consegna che non e' mai arrivata.
    await announceQuoteDecision(PREVENTIVO, "declined", null);

    expect(emessi[0].evento).toBe("quote.declined");
  });

  it("⚠️ dichiara l'origine «persona» anche quando a premere e' il cliente senza account", async () => {
    // Quel campo serve a scartare gli eventi che un'integrazione ha causato lei. Questo
    // non lo ha causato: marcarlo «macchina» le farebbe scartare la risposta che aspetta.
    await announceQuoteDecision(PREVENTIVO, "accepted", null);

    expect(emessi[0].origin).toEqual({ via: "user", actor: null });
  });

  it("porta il recapito, perche' l'id del preventivo dall'altra parte non significa niente", async () => {
    await announceQuoteDecision(PREVENTIVO, "accepted", "u7");

    expect(emessi[0].carico.email).toBe("mario@example.it");
    expect(emessi[0].carico.phone).toBe("+393330000001");
  });
});

describe("un preventivo che parte una seconda volta", () => {
  it("⚠️⚠️ uno gia' inviato che viene solo risalvato non e' una partenza", () => {
    // Senza questa distinzione l'evento significa «lo stato dice inviato» invece di
    // «e' appena partito»: modificare una nota su un preventivo gia' mandato consegna al
    // cliente lo stesso PDF una seconda volta, e non fallisce niente.
    for (const stato of ["sent", "viewed", "accepted", "declined", "converted"]) {
      expect(hasAlreadyLeft(stato), `«${stato}» non e' riconosciuto come gia' uscito`).toBe(true);
    }
  });

  it("una bozza che diventa inviata e' una partenza vera", () => {
    expect(hasAlreadyLeft("draft")).toBe(false);
    expect(hasAlreadyLeft("expired")).toBe(false);
  });
});

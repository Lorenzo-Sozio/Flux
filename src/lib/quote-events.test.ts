/**
 * The event that tells an integration a quote has gone out.
 *
 * ⚠️⚠️ Before this file nothing was emitted when a quote moved to "sent": an assistant
 * waiting to hand that document over would have waited for ever, and nothing would have
 * failed. It is the worst shape of failure, because the owner believes they sent it and
 * the customer does not know it exists.
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
    // else: it is the route that renders the document for whoever holds the token.
    expect(emessi[0].carico.url).toBe(
      "https://flux.example.test/api/quotes/q1/pdf?token=6f1c0b2e-1111-2222-3333-444455556666",
    );
  });

  it("⚠️⚠️ senza indirizzo di base NON inventa un localhost", async () => {
    // A default here would not fail: it would send a real customer a link to a machine
    // that is not theirs. A successful delivery to the wrong place.
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
    // Without it the attachment arrives nameless, which looks a lot like something not to open.
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
    // Anybody who only hears about acceptances has to treat silence as a refusal, and
    // silence also means a delivery that never arrived.
    await announceQuoteDecision(PREVENTIVO, "declined", null);

    expect(emessi[0].evento).toBe("quote.declined");
  });

  it("⚠️ dichiara l'origine «persona» anche quando a premere e' il cliente senza account", async () => {
    // That field exists to discard the events an integration caused itself. It did not
    // cause this one: marking it "machine" would have it discard the answer it is waiting for.
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
    // Without that distinction the event means "the status says sent" rather than "it has
    // just gone out": editing a note on an already-sent quote delivers the same PDF to the
    // customer a second time, and nothing fails.
    for (const stato of ["sent", "viewed", "accepted", "declined", "converted"]) {
      expect(hasAlreadyLeft(stato), `«${stato}» non e' riconosciuto come gia' uscito`).toBe(true);
    }
  });

  it("una bozza che diventa inviata e' una partenza vera", () => {
    expect(hasAlreadyLeft("draft")).toBe(false);
    expect(hasAlreadyLeft("expired")).toBe(false);
  });
});

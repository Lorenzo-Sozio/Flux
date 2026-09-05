/**
 * L'azione che permette a una regola di parlare a un'integrazione.
 *
 * ⚠️⚠️ Il valore difeso qui è che quell'evento sia **firmato e con la busta**. `send_webhook`
 * manda una POST grezza — url, intestazioni e corpo scritti a mano — e va benissimo per
 * chiamare qualcosa dalla forma fissa; non va per un'integrazione che pretende una firma,
 * perché nessuno calcola un HMAC dentro un costruttore di regole. Senza questa distinzione
 * la condizione si può scrivere e l'altro capo la rifiuta: una regola che sembra non essere
 * mai scattata.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const emessi: { evento: string; carico: Record<string, unknown>; origin: unknown }[] = [];
const grezzi: unknown[] = [];

vi.mock("@/actions/webhooks", () => ({
  dispatchWebhook: async (evento: string, carico: Record<string, unknown>, origin: unknown) => {
    emessi.push({ evento, carico, origin });
  },
}));
vi.mock("../../crm/automation/webhook-service", () => ({
  sendWebhook: async (...a: unknown[]) => {
    grezzi.push(a);
    return { statusCode: 200, retries: 0 };
  },
}));
vi.mock("@/lib/tenant-context", () => ({ getDb: async () => ({}) }));
vi.mock("@/db/schema", () => ({
  companies: {},
  contacts: {},
  deals: {},
  emailTemplates: {},
  leads: {},
  notifications: {},
  tasks: {},
  tickets: {},
}));
vi.mock("drizzle-orm", () => ({ eq: () => "eq" }));
vi.mock("../../crm/automation/email-service", () => ({
  sendAutomationEmailWithContext: async () => ({ retries: 0 }),
}));
vi.mock("../../crm/automation/rule-engine", () => ({
  runAutomations: async () => undefined,
}));
vi.mock("../../crm/automation/loop-detector", () => ({}));

const modulo = await import("@/components/crm/automation/action-dispatcher");
// biome-ignore lint/suspicious/noExplicitAny: the dispatcher's own export shape
const Dispatcher: any = Object.values(modulo).find((v) => typeof v === "function");

const CONTESTO = {
  entityType: "deal" as const,
  entityId: "d1",
  event: "onUpdate" as const,
  oldData: { amount: 100 },
  newData: { amount: 20000, name: "Tetto" },
  currentUserId: "u7",
};

function azione(params: Record<string, unknown>) {
  return { type: "emit_event" as const, params };
}

beforeEach(() => {
  emessi.length = 0;
  grezzi.length = 0;
});

describe("una regola che parla a un'integrazione", () => {
  it("⚠️⚠️ passa dalla envelope firmata, non da una POST grezza", async () => {
    const d = new Dispatcher();
    await d.dispatch(azione({ event: "lead.escalate" }), CONTESTO, {});

    expect(emessi).toHaveLength(1);
    expect(grezzi, "e' passata dalla POST grezza: l'altro capo la rifiuterebbe").toHaveLength(0);
    expect(emessi[0].evento).toBe("lead.escalate");
  });

  it("manda l'entita' com'e' DOPO il cambiamento", async () => {
    // Una regola reagisce allo stato nuovo: mandare quello vecchio farebbe agire chi
    // riceve su qualcosa che non e' piu' vero.
    const d = new Dispatcher();
    await d.dispatch(azione({ event: "deal.big" }), CONTESTO, {});

    expect((emessi[0].carico as Record<string, unknown>).deal).toEqual(CONTESTO.newData);
    expect(emessi[0].carico.entityId).toBe("d1");
  });

  it("⚠️ dichiara l'origine «persona», perche' una regola scatta per un gesto umano", async () => {
    // Marcarla «macchina» la farebbe ignorare da un'integrazione che filtra le proprie
    // scritture, e la regola sembrerebbe non essere mai scattata.
    const d = new Dispatcher();
    await d.dispatch(azione({ event: "lead.escalate" }), CONTESTO, {});

    expect(emessi[0].origin).toEqual({ via: "user", actor: "u7" });
  });

  it("porta con se' i campi in piu' che la regola ha scritto", async () => {
    const d = new Dispatcher();
    await d.dispatch(azione({ event: "quote.ready", payload: { url: "https://x/p.pdf" } }), CONTESTO, {});

    expect(emessi[0].carico.url).toBe("https://x/p.pdf");
  });
});

/**
 * The envelope an event travels in, and what it refuses to send.
 *
 * Three of the four things pinned here are the difference between an integration that can
 * be trusted and one that cannot: a signature, an id, and who caused the change. The
 * fourth is what happens when the first is missing — and the answer is «nothing goes out»,
 * which is a decision, not an omission.
 */
import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const righe: Record<string, unknown>[] = [];
const inviati: { url: string; headers: Record<string, string>; body: string }[] = [];
let configurati: Record<string, unknown>[] = [];

// ⚠️ Si sostituiscono i moduli che questo file importa **davvero**: `tenant-context` per
// il database e `auth-guard` perché tira dentro next-auth, che in un test di nodo non ha un
// runtime Next da cui prendere `next/server`. Mockare il modulo sbagliato non fallisce: fa
// caricare quello vero, e l'errore che si legge parla di tutt'altro.
vi.mock("@/lib/tenant-context", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: async () => configurati }) }),
    insert: () => ({ values: async (v: Record<string, unknown>) => righe.push(v) }),
  }),
}));
vi.mock("@/lib/auth-guard", () => ({
  ForbiddenError: class extends Error {},
  requireAdminAccess: async () => undefined,
}));
vi.mock("@/db/schema", () => ({ webhooks: { isActive: "is_active" }, webhookLogs: {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("drizzle-orm", () => ({ desc: () => {}, eq: () => {} }));
vi.mock("@/lib/webhook-validator", () => ({ validateWebhookUrl: () => null }));

const { dispatchWebhook } = await import("@/actions/webhooks");

const SEGRETO = "un-segreto";

function webhook(extra: Record<string, unknown> = {}) {
  return { id: "w1", url: "https://ricevente.example/hook", events: ["*"], secret: SEGRETO, ...extra };
}

beforeEach(() => {
  righe.length = 0;
  inviati.length = 0;
  configurati = [webhook()];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    inviati.push({
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: String(init.body),
    });
    return { status: 200, ok: true, text: async () => "" } as unknown as Response;
  });
});

describe("⚠️⚠️ an event without a signature does not leave", () => {
  it("refuses to deliver to a webhook with no secret", async () => {
    // An unsigned event is one the receiver cannot tell apart from anything else that can
    // reach its URL. Delivering it anyway and letting them decide puts the choice in the
    // place with the least context.
    configurati = [webhook({ secret: null })];

    await dispatchWebhook("lead.created", { id: "l1" });

    expect(inviati).toHaveLength(0);
  });

  it("records WHY it did not deliver, instead of failing silently", async () => {
    // A webhook that quietly stops delivering is the worst kind of broken: everything
    // looks configured, and nothing arrives. The log row is how the owner finds out.
    configurati = [webhook({ secret: null })];

    await dispatchWebhook("lead.created", { id: "l1" });

    expect(righe).toHaveLength(1);
    expect(String(righe[0].response)).toMatch(/no secret|Add one/);
    expect(righe[0].success).toBe(false);
    // ⚠️ E **nessuno stato HTTP**: non c'è stata una consegna, quindi non c'è un codice
    // che qualcuno possa aver risposto. Una riga con `success: false` e uno stato `200`
    // si contraddice, e chi la legge nel pannello non sa a quale delle due credere.
    expect(righe[0].statusCode).toBeNull();
  });

  it("signs the exact bytes it sends, not a reconstruction of them", async () => {
    // Signing a re-serialised copy is the classic way a signature stops meaning anything:
    // two serialisations of the same object differ, and the receiver's check fails for
    // everyone or — worse — is relaxed until it passes.
    await dispatchWebhook("lead.created", { id: "l1" });

    const { headers, body } = inviati[0];
    const atteso = `sha256=${createHmac("sha256", SEGRETO).update(body).digest("hex")}`;
    expect(headers["X-Webhook-Signature"]).toBe(atteso);
  });
});

describe("the id, so a retry is not a second event", () => {
  it("gives every event a unique id, in the body and in the header", async () => {
    await dispatchWebhook("lead.created", { id: "l1" });
    const primo = JSON.parse(inviati[0].body);

    expect(primo.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(inviati[0].headers["X-Webhook-Id"]).toBe(primo.id);
  });

  it("does not reuse an id between two different events", async () => {
    // If two events shared an id, a receiver deduping on it would drop the second — and
    // dropping a real event is exactly what the id exists to prevent.
    await dispatchWebhook("lead.created", { id: "l1" });
    await dispatchWebhook("lead.created", { id: "l2" });

    expect(JSON.parse(inviati[0].body).id).not.toBe(JSON.parse(inviati[1].body).id);
  });
});

describe("who caused it, so nobody chases their own tail", () => {
  it("says a machine wrote it when the caller says so", async () => {
    await dispatchWebhook("lead.created", { id: "l1" }, { via: "api", actor: null });

    expect(JSON.parse(inviati[0].body).origin).toEqual({ via: "api", actor: null });
  });

  it("defaults to a person, because that is the common case and the safe one", async () => {
    // ⚠️ The default matters: an event wrongly marked `api` would be ignored by an
    // integration that filters its own writes, and a real change would be lost. Wrongly
    // marked `user` costs at most one extra round trip.
    await dispatchWebhook("lead.created", { id: "l1" });

    expect(JSON.parse(inviati[0].body).origin.via).toBe("user");
  });
});

describe("what the envelope carries", () => {
  it("keeps the event name and the payload where a receiver expects them", async () => {
    await dispatchWebhook("deal.won", { id: "d1", amount: 10 });

    const busta = JSON.parse(inviati[0].body);
    expect(busta.event).toBe("deal.won");
    expect(busta.payload).toEqual({ id: "d1", amount: 10 });
    expect(typeof busta.timestamp).toBe("string");
  });

  it("logs the delivery with the status the receiver returned", async () => {
    await dispatchWebhook("deal.won", { id: "d1" });

    expect(righe[0].statusCode).toBe(200);
    expect(righe[0].success).toBe(true);
  });
});

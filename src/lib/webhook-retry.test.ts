/**
 * What gets retried, what does not, and when.
 *
 * The decision is pure on purpose, and these tests pin it down without a database: these
 * are the rules that decide whether an event reaches its destination or stays lost — and a
 * lost event, with no retry, is one nobody knows about.
 */
import { describe, expect, it } from "vitest";

import { MAX_ATTEMPTS, UNSIGNABLE_PREFIX } from "@/lib/webhook-envelope";
import { eventIdOf, isRetryable } from "@/lib/webhook-retry";

const ADESSO = new Date("2026-09-02T12:00:00Z");

function body(id: string) {
  return JSON.stringify({ id, event: "lead.created", payload: {}, origin: { via: "user" } });
}

function attempt(extra: Partial<Parameters<typeof isRetryable>[0][number]> = {}) {
  return {
    id: crypto.randomUUID(),
    webhookId: "w1",
    event: "lead.created",
    payload: body("evento-1"),
    response: "boom",
    success: false,
    // Old enough to be due whatever the wait.
    sentAt: new Date(ADESSO.getTime() - 24 * 60 * 60 * 1000),
    ...extra,
  };
}

describe("l'identificativo, che è ciò da cui si ricava tutto il resto", () => {
  it("lo legge dal body spedito", () => {
    expect(eventIdOf(body("abc"))).toBe("abc");
  });

  it("non inventa niente quando il body non è leggibile", () => {
    // A made-up id would group attempts from different events together, and the count
    // would claim enough tries had been made on something never sent.
    expect(eventIdOf("non-json")).toBe("");
    expect(eventIdOf(null)).toBe("");
    expect(eventIdOf(JSON.stringify({ event: "x" }))).toBe("");
  });
});

describe("che cosa si riprova", () => {
  it("un evento il cui unico attempt è fallito", () => {
    expect(isRetryable([attempt()], ADESSO)).toHaveLength(1);
  });

  it("⚠️ NON un evento che è arrivato, anche se prima era fallito dieci volte", () => {
    // Any successful attempt closes the matter. Without that, an event delivered on the
    // second try would be sent again for ever.
    const righe = [attempt(), attempt({ success: true })];

    expect(isRetryable(righe, ADESSO)).toHaveLength(0);
  });

  it("⚠️⚠️ NON un attempt mai partito per mancanza di secret", () => {
    // Retrying does not add a secret: it would repeat, for days, a row that is asking to
    // be configured, filling the log with noise in exactly the place somebody looks
    // il motivo.
    const righe = [attempt({ response: `${UNSIGNABLE_PREFIX}, so the event…` })];

    expect(isRetryable(righe, ADESSO)).toHaveLength(0);
  });

  it("smette dopo i attempts previsti", () => {
    // Without a limit, an address that no longer exists would be called for ever.
    const righe = Array.from({ length: MAX_ATTEMPTS }, () => attempt());

    expect(isRetryable(righe, ADESSO)).toHaveLength(0);
    expect(isRetryable(righe.slice(1), ADESSO)).toHaveLength(1);
  });

  it("tiene separati due eventi diversi", () => {
    const righe = [attempt(), attempt({ payload: body("evento-2") })];

    expect(isRetryable(righe, ADESSO)).toHaveLength(2);
  });

  it("ignora una riga senza identificativo invece di trattarla come un evento", () => {
    expect(isRetryable([attempt({ payload: "non-json" })], ADESSO)).toHaveLength(0);
  });
});

describe("quando si riprova", () => {
  it("⚠️ non prima che l'attesa sia passata", () => {
    // Retrying at once means hammering a provider that has just fallen over, and earning
    // a second failure that spends an attempt for nothing.
    const appena = [attempt({ sentAt: new Date(ADESSO.getTime() - 1000) })];

    expect(isRetryable(appena, ADESSO)).toHaveLength(0);
  });

  it("l'attesa cresce con i attempts", () => {
    // After the first failure a minute is enough; after the second it no longer is.
    const dueMinuti = new Date(ADESSO.getTime() - 2 * 60_000);
    const uno = [attempt({ sentAt: dueMinuti })];
    const due = [attempt({ sentAt: dueMinuti }), attempt({ sentAt: dueMinuti })];

    expect(isRetryable(uno, ADESSO), "il primo ritentativo doveva essere dovuto").toHaveLength(1);
    expect(isRetryable(due, ADESSO), "il secondo non doveva esserlo ancora").toHaveLength(0);
  });

  it("misura l'attesa dall'ULTIMO attempt, non dal primo", () => {
    // Misurarla dal primo farebbe scattare tutti i ritentativi successivi insieme, subito
    // after the first failure: the opposite of a growing wait.
    const vecchio = attempt({ sentAt: new Date(ADESSO.getTime() - 24 * 60 * 60 * 1000) });
    const recente = attempt({ sentAt: new Date(ADESSO.getTime() - 1000) });

    expect(isRetryable([vecchio, recente], ADESSO)).toHaveLength(0);
  });
});

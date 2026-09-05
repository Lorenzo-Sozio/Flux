/**
 * Che cosa si riprova, che cosa no, e quando.
 *
 * La decisione è pura di proposito, e questi test la fissano senza database: sono le regole
 * che decidono se un evento arriva a destinazione o resta perso — e un evento perso, senza
 * ritentativo, non lo sa nessuno.
 */
import { describe, expect, it } from "vitest";

import { MAX_ATTEMPTS, UNSIGNABLE_PREFIX } from "@/lib/webhook-envelope";
import { daRiprovare, identificativoDi } from "@/lib/webhook-retry";

const ADESSO = new Date("2026-09-02T12:00:00Z");

function body(id: string) {
  return JSON.stringify({ id, event: "lead.created", payload: {}, origin: { via: "user" } });
}

function attempt(extra: Partial<Parameters<typeof daRiprovare>[0][number]> = {}) {
  return {
    id: crypto.randomUUID(),
    webhookId: "w1",
    event: "lead.created",
    payload: body("evento-1"),
    response: "boom",
    success: false,
    // Vecchio abbastanza da essere dovuto con qualunque attesa.
    sentAt: new Date(ADESSO.getTime() - 24 * 60 * 60 * 1000),
    ...extra,
  };
}

describe("l'identificativo, che è ciò da cui si ricava tutto il resto", () => {
  it("lo legge dal body spedito", () => {
    expect(identificativoDi(body("abc"))).toBe("abc");
  });

  it("non inventa niente quando il body non è leggibile", () => {
    // Un identificativo inventato raggrupperebbe tentativi di eventi diversi, e il
    // conteggio direbbe che si è già provato abbastanza su qualcosa mai spedito.
    expect(identificativoDi("non-json")).toBe("");
    expect(identificativoDi(null)).toBe("");
    expect(identificativoDi(JSON.stringify({ event: "x" }))).toBe("");
  });
});

describe("che cosa si riprova", () => {
  it("un evento il cui unico attempt è fallito", () => {
    expect(daRiprovare([attempt()], ADESSO)).toHaveLength(1);
  });

  it("⚠️ NON un evento che è arrivato, anche se prima era fallito dieci volte", () => {
    // Qualunque tentativo riuscito chiude la partita. Senza, un evento consegnato al
    // secondo colpo verrebbe rispedito per sempre.
    const righe = [attempt(), attempt({ success: true })];

    expect(daRiprovare(righe, ADESSO)).toHaveLength(0);
  });

  it("⚠️⚠️ NON un attempt mai partito per mancanza di secret", () => {
    // Ritentare non aggiunge un segreto: ripeterebbe per giorni una riga che chiede una
    // configurazione, e il registro si riempirebbe di rumore proprio dove si va a cercare
    // il motivo.
    const righe = [attempt({ response: `${UNSIGNABLE_PREFIX}, so the event…` })];

    expect(daRiprovare(righe, ADESSO)).toHaveLength(0);
  });

  it("smette dopo i attempts previsti", () => {
    // Senza un limite, un indirizzo che non esiste più verrebbe chiamato per sempre.
    const righe = Array.from({ length: MAX_ATTEMPTS }, () => attempt());

    expect(daRiprovare(righe, ADESSO)).toHaveLength(0);
    expect(daRiprovare(righe.slice(1), ADESSO)).toHaveLength(1);
  });

  it("tiene separati due eventi diversi", () => {
    const righe = [attempt(), attempt({ payload: body("evento-2") })];

    expect(daRiprovare(righe, ADESSO)).toHaveLength(2);
  });

  it("ignora una riga senza identificativo invece di trattarla come un evento", () => {
    expect(daRiprovare([attempt({ payload: "non-json" })], ADESSO)).toHaveLength(0);
  });
});

describe("quando si riprova", () => {
  it("⚠️ non prima che l'attesa sia passata", () => {
    // Riprovare subito significa martellare un fornitore che è appena caduto, e ottenere
    // un secondo fallimento che consuma un tentativo per niente.
    const appena = [attempt({ sentAt: new Date(ADESSO.getTime() - 1000) })];

    expect(daRiprovare(appena, ADESSO)).toHaveLength(0);
  });

  it("l'attesa cresce con i attempts", () => {
    // Al primo fallimento si riprova dopo un minuto; al secondo un minuto non basta più.
    const dueMinuti = new Date(ADESSO.getTime() - 2 * 60_000);
    const uno = [attempt({ sentAt: dueMinuti })];
    const due = [attempt({ sentAt: dueMinuti }), attempt({ sentAt: dueMinuti })];

    expect(daRiprovare(uno, ADESSO), "il primo ritentativo doveva essere dovuto").toHaveLength(1);
    expect(daRiprovare(due, ADESSO), "il secondo non doveva esserlo ancora").toHaveLength(0);
  });

  it("misura l'attesa dall'ULTIMO attempt, non dal primo", () => {
    // Misurarla dal primo farebbe scattare tutti i ritentativi successivi insieme, subito
    // dopo il primo fallimento: il contrario di un'attesa crescente.
    const vecchio = attempt({ sentAt: new Date(ADESSO.getTime() - 24 * 60 * 60 * 1000) });
    const recente = attempt({ sentAt: new Date(ADESSO.getTime() - 1000) });

    expect(daRiprovare([vecchio, recente], ADESSO)).toHaveLength(0);
  });
});

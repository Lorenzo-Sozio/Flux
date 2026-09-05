/**
 * Chi e' raggiungibile a un recapito, e dove si scrive quello che gli e' successo.
 *
 * ⚠️ Il modulo esiste perche' la regola aveva **due** chiamanti — la cancellazione e la nota
 * che il motore scrive — e due copie di «e' la stessa persona» divergono. Il giorno in cui
 * divergessero, una scriverebbe una nota addosso a qualcun altro mentre l'altra gli dice che
 * e' stato cancellato.
 */
import { describe, expect, it } from "vitest";

import { readContactPoint, whereToNote } from "@/lib/contact-point";

describe("dove si annota", () => {
  it("⚠️⚠️ il contatto vince sul lead quando ci sono entrambi", () => {
    // Un lead convertito conserva la propria riga vecchia: scrivere li' mette la nota sulla
    // pagina che nessuno apre piu', e l'assistente registrerebbe correttamente cio' che ha
    // fatto in un posto dove il commerciale non guarda.
    const dove = whereToNote({ leadIds: ["l1"], contactIds: ["c1"], email: null, digits: null });

    expect(dove).toEqual({ contactId: "c1", leadId: null });
  });

  it("sul lead quando il contatto non c'e'", () => {
    const dove = whereToNote({ leadIds: ["l1"], contactIds: [], email: null, digits: null });

    expect(dove).toEqual({ contactId: null, leadId: "l1" });
  });

  it("⚠️ niente quando non c'e' nessuno, e chi chiama deve rifiutare", () => {
    // Una nota orfana e' l'unica traccia di quello che e' successo, persa: e una traccia
    // persa e' invisibile per definizione.
    expect(whereToNote({ leadIds: [], contactIds: [], email: null, digits: null })).toBeNull();
  });
});

describe("come si legge un contactPoint", () => {
  it("un indirizzo di posta si riconosce dalla chiocciola", () => {
    expect(readContactPoint("  Mario@Example.IT ")).toEqual({ email: "mario@example.it", digits: null });
  });

  it("un numero si confronta sulle sole cifre", () => {
    // Un numero scritto con gli spazi e uno scritto senza sono la stessa persona.
    expect(readContactPoint("+39 333 111 2223").digits).toBe(readContactPoint("+393331112223").digits);
  });

  it("⚠️ un contactPoint che non e' ne' l'uno ne' l'altro viene rifiutato", () => {
    // Un refuso che passasse riceverebbe «non trovato», che dice una cosa diversa da
    // «quello che mi hai dato non e' un recapito».
    expect(() => readContactPoint("mario")).toThrow();
    expect(() => readContactPoint("   ")).toThrow();
  });
});

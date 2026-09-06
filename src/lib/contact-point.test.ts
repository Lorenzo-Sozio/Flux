/**
 * Who is reachable at a contact point, and where what happened to them gets written.
 *
 * ⚠️ The module exists because the rule had **two** callers — erasure and the note
 * the engine writes — and two copies of "this is the same person" drift apart. The day
 * they did, one would write a note onto somebody else while the other told them they had
 * been erased.
 */
import { describe, expect, it } from "vitest";

import { readContactPoint, whereToNote } from "@/lib/contact-point";

describe("dove si annota", () => {
  it("⚠️⚠️ il contatto vince sul lead quando ci sono entrambi", () => {
    // A converted lead keeps its old row: writing there puts the note on the page nobody
    // opens any more, and the assistant would correctly record what it did somewhere the
    // salesperson never looks.
    const dove = whereToNote({ leadIds: ["l1"], contactIds: ["c1"], email: null, digits: null });

    expect(dove).toEqual({ contactId: "c1", leadId: null });
  });

  it("sul lead quando il contatto non c'e'", () => {
    const dove = whereToNote({ leadIds: ["l1"], contactIds: [], email: null, digits: null });

    expect(dove).toEqual({ contactId: null, leadId: "l1" });
  });

  it("⚠️ niente quando non c'e' nessuno, e chi chiama deve rifiutare", () => {
    // An orphaned note is the only trace of what happened, lost: and a trace
    // persa e' invisibile per definizione.
    expect(whereToNote({ leadIds: [], contactIds: [], email: null, digits: null })).toBeNull();
  });
});

describe("come si legge un contactPoint", () => {
  it("un indirizzo di posta si riconosce dalla chiocciola", () => {
    expect(readContactPoint("  Mario@Example.IT ")).toEqual({ email: "mario@example.it", digits: null });
  });

  it("un numero si confronta sulle sole cifre", () => {
    // A number written with spaces and one written without are the same person.
    expect(readContactPoint("+39 333 111 2223").digits).toBe(readContactPoint("+393331112223").digits);
  });

  it("⚠️ un contactPoint che non e' ne' l'uno ne' l'altro viene rifiutato", () => {
    // A typo getting through would be answered "not found", which says something different
    // from "what you gave me is not a contact point".
    expect(() => readContactPoint("mario")).toThrow();
    expect(() => readContactPoint("   ")).toThrow();
  });
});

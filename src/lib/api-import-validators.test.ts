/**
 * What the import API accepts, and what it turns that into.
 *
 * This is the second half of the boundary surface. The first half decides *whose*
 * database a write lands in; this one decides *what* lands there — and two of the things
 * it decides today are known gaps that another product is waiting on.
 *
 * Those gaps are written down here as executable notes rather than prose, using
 * `it.fails`: the test passes while the behaviour is still broken and starts failing the
 * day someone fixes it, which is precisely when a note is worth reading. A gap recorded in
 * a document is a gap nobody re-reads; a gap recorded here knocks.
 */
import { describe, expect, it } from "vitest";

import { buildLeadPayload, parseOnDuplicate, validateLeadInput } from "@/lib/api-import-validators";

describe("what a lead must carry", () => {
  it("accepts a lead with a first and last name", () => {
    const { errors, data } = validateLeadInput({ firstName: "Anna", lastName: "Rossi" });

    expect(errors).toEqual([]);
    expect(data?.firstName).toBe("Anna");
    expect(data?.lastName).toBe("Rossi");
  });

  it("trims the name instead of storing the spaces someone pasted", () => {
    const { data } = validateLeadInput({ firstName: "  Anna  ", lastName: " Rossi " });

    expect(data?.firstName).toBe("Anna");
    expect(data?.lastName).toBe("Rossi");
  });

  it("names every missing field at once, not the first one", () => {
    const { errors, data } = validateLeadInput({});

    expect(data).toBeNull();
    const campi = errors.map((e) => e.field);
    expect(campi).toContain("firstName");
    expect(campi).toContain("lastName");
    // Returning them one at a time would make an importer of 500 rows a conversation of
    // 500 round trips.
    expect(campi.length).toBeGreaterThanOrEqual(2);
  });

  it("treats a blank string as missing, because it is", () => {
    const { errors } = validateLeadInput({ firstName: "   ", lastName: "Rossi" });

    expect(errors.map((e) => e.field)).toContain("firstName");
  });

  it.fails("⛔ KNOWN GAP — a caller who only has a phone number cannot create a lead", () => {
    // On a phone call a contact often has nothing but a number: no name is offered, and
    // asking for a surname before saying hello is not how a phone call goes.
    //
    // The engine's first CRM write is exactly this shape, so today it would get a 422.
    // When this test starts failing, the gap is closed — delete `.fails` and keep the
    // assertion.
    const { errors } = validateLeadInput({ phone: "+39 333 111 2223" });

    expect(errors).toEqual([]);
  });
});

describe("duplicates", () => {
  it("defaults to skipping, so a retry is not a second lead", () => {
    expect(parseOnDuplicate({})).toBe("skip");
    expect(parseOnDuplicate({ onDuplicate: "nonsense" })).toBe("skip");
  });

  it("honours the two explicit choices", () => {
    expect(parseOnDuplicate({ onDuplicate: "update" })).toBe("update");
    expect(parseOnDuplicate({ onDuplicate: "error" })).toBe("error");
  });

  it("⛔ KNOWN GAP — deduplication has nothing to work with when the contact has no email", () => {
    // The route matches an existing lead on `email` alone. A contact who arrived by phone
    // has no email, so every retry creates another row — and the phone column is free text
    // with no normalisation and no unique constraint, so "+39 333 111 2223" and
    // "+393331112223" are two different people as far as this code is concerned.
    //
    // Measured against the running instance on 2026-09-01: two POSTs, two 201s, two ids.
    const primo = validateLeadInput({ firstName: "Anna", lastName: "Rossi", phone: "+39 333 111 2223" });
    const secondo = validateLeadInput({ firstName: "Anna", lastName: "Rossi", phone: "+393331112223" });

    expect(primo.data?.email).toBeNull();
    expect(secondo.data?.email).toBeNull();
    // Nothing here normalises the two spellings towards each other. This assertion is the
    // gap: the day a normaliser exists, it fails and asks to be updated.
    expect(primo.data?.phone).not.toBe(secondo.data?.phone);
  });
});

describe("consent", () => {
  it("defaults to false when the caller says nothing", () => {
    const { data } = validateLeadInput({ firstName: "Anna", lastName: "Rossi" });

    expect(data?.marketingConsent).toBe(false);
  });

  it("⛔ KNOWN GAP — marketing consent is writable through the API", () => {
    // Consent belongs to whatever actually speaks to the customer, and there is exactly
    // one thing that does. A second writable copy of it means two answers to "may we
    // contact this person", and the one that is wrong is the one nobody updated.
    //
    // This field should become read-only here, fed from the engine, and never written by
    // a connector.
    const acceso = validateLeadInput({ firstName: "Anna", lastName: "Rossi", marketingConsent: true });
    const spento = validateLeadInput({ firstName: "Anna", lastName: "Rossi", marketingConsent: false });

    expect(acceso.data?.marketingConsent).toBe(true);
    expect(spento.data?.marketingConsent).toBe(false);
  });
});

describe("the row that gets written", () => {
  it("carries the owner given to it, and not one it invented", () => {
    const { data } = validateLeadInput({ firstName: "Anna", lastName: "Rossi" });
    const payload = buildLeadPayload(data as NonNullable<typeof data>, "user-7");

    expect(payload.firstName).toBe("Anna");
    expect(JSON.stringify(payload)).toContain("user-7");
  });

  it("accepts a null owner, which is what an API-key caller has", () => {
    const { data } = validateLeadInput({ firstName: "Anna", lastName: "Rossi" });

    expect(() => buildLeadPayload(data as NonNullable<typeof data>, null)).not.toThrow();
  });
});

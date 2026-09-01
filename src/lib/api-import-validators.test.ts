/**
 * What the import API accepts, and what it turns that into.
 *
 * This is the second half of the boundary surface. The first half decides *whose*
 * database a write lands in; this one decides *what* lands there.
 *
 * Two of the gaps recorded here as `it.fails` have since been closed, and closing them is
 * how the device proved itself: an `it.fails` passes while the behaviour is broken and
 * starts failing the day someone fixes it, so it knocked instead of being forgotten. A gap
 * written in a document is a gap nobody re-reads.
 *
 * One is left, and it is not a bug to fix here: marketing consent is writable through this
 * API. It becomes a problem the day something else also writes it, which is why it is
 * still a note.
 */
import { describe, expect, it } from "vitest";

import {
  buildLeadPayload,
  digitsForMatching,
  parseOnDuplicate,
  validateContactInput,
  validateLeadInput,
} from "@/lib/api-import-validators";

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

  it("refuses a body that identifies nobody, and says what would do", () => {
    const { errors, data } = validateLeadInput({});

    expect(data).toBeNull();
    expect(errors.map((e) => e.field)).toEqual(["identity"]);
    // The message has to name the alternatives: "firstName is required" would send an
    // integrator looking for a name it does not have, when a phone number would do.
    expect(errors[0].message).toMatch(/firstName.*lastName.*email.*phone/);
  });

  it("treats a blank string as no value at all", () => {
    const { errors } = validateLeadInput({ firstName: "   ", lastName: "   " });

    expect(errors.map((e) => e.field)).toEqual(["identity"]);
  });

  it("accepts a caller who only has a phone number", () => {
    // On a phone call a contact often has nothing but a number: no name is offered, and
    // asking for a surname before saying hello is not how a phone call goes. This is the
    // shape of the engine's first CRM write, and it used to get a 422.
    const { errors, data } = validateLeadInput({ phone: "+39 333 111 2223" });

    expect(errors).toEqual([]);
    expect(data?.phone).toBe("+39 333 111 2223");
  });

  it("calls a nameless lead by its contact point, and never 'null null'", () => {
    // ⚠️ The columns stay NOT NULL because 63 places in this codebase compose a lead's
    // name by hand. A nameless lead is therefore called by what is actually known about
    // it — which is also what a CRM shows for an unknown caller.
    const perTelefono = validateLeadInput({ phone: "+39 333 111 2223" }).data;
    expect(perTelefono?.firstName).toBe("+39 333 111 2223");
    expect(perTelefono?.lastName).toBe("");

    const perEmail = validateLeadInput({ email: "anna@example.test" }).data;
    expect(perEmail?.firstName).toBe("anna@example.test");
    expect(perEmail?.lastName).toBe("");

    // A real name always wins over the contact point.
    const conNome = validateLeadInput({ firstName: "Anna", phone: "+39 333 111 2223" }).data;
    expect(conNome?.firstName).toBe("Anna");
    expect(conNome?.lastName).toBe("");
  });
});

describe("a contact is not a lead, and still needs a name", () => {
  it("requires both names, because a contact is a person at a company we already know", () => {
    // ⚠️ Deliberately NOT relaxed the way a lead was. A lead arrives from outside and may
    // be nothing but a phone number; a contact is created against a company that is
    // already in the CRM, by someone who is looking at it. "I do not know their name" is a
    // normal state for the first, and a mistake for the second.
    const { errors, data } = validateContactInput({});

    expect(data).toBeNull();
    const campi = errors.map((e) => e.field);
    expect(campi).toContain("firstName");
    expect(campi).toContain("lastName");
  });

  it("treats a blank string as missing here too", () => {
    const { errors } = validateContactInput({ firstName: "   ", lastName: "Rossi" });

    expect(errors.map((e) => e.field)).toContain("firstName");
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

  it("matches the same international number however it was typed", () => {
    // The failure this closes, measured on the running instance on 2026-09-01: these two
    // spellings produced two leads with two ids, so every retry of a phone-only contact
    // created another row.
    expect(digitsForMatching("+39 333 111 2223")).toBe("393331112223");
    expect(digitsForMatching("+393331112223")).toBe("393331112223");
    expect(digitsForMatching("0039-333-111-2223")).toBe("393331112223");
    expect(digitsForMatching("(+39) 333/111.2223")).toBe("393331112223");
  });

  it("⚠️ does NOT match a national number to its international form, on purpose", () => {
    // Making these match means guessing a country, and a wrong guess merges two different
    // people into one record. A duplicate is visible and fixable; a merge silently destroys
    // the fact that there were two, and the next message goes to whichever one survived.
    expect(digitsForMatching("333 111 2223")).toBe("3331112223");
    expect(digitsForMatching("333 111 2223")).not.toBe(digitsForMatching("+39 333 111 2223"));
  });

  it("refuses to match on something that is not a phone number", () => {
    // Without this, two leads whose "phone" is "12" would be the same person.
    expect(digitsForMatching("12")).toBeNull();
    expect(digitsForMatching("")).toBeNull();
    expect(digitsForMatching(null)).toBeNull();
    expect(digitsForMatching(undefined)).toBeNull();
    expect(digitsForMatching(3331112223)).toBeNull();
  });

  it("keeps the number exactly as it was typed in the stored lead", () => {
    // Normalisation is for matching only: people recognise their own number by its
    // spacing, and a CRM that shows something nobody entered looks broken.
    const { data } = validateLeadInput({ phone: "+39 333 111 2223" });

    expect(data?.phone).toBe("+39 333 111 2223");
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

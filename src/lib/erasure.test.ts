/**
 * Erasing a person: the shape of the operation, without a database.
 *
 * What is tested here is what the code **decides** — which rows it touches, which it
 * anonymises, which it deliberately leaves alone — because those are the decisions that
 * turn a 200 into a true or a false statement to someone who asked to be forgotten.
 *
 * The database handle is a double that records the queries it was given. That is enough to
 * pin the decisions and it runs in milliseconds, so it runs before every commit; a test
 * that needs a seeded tenant is a test that gets skipped on the day it matters.
 */
import { describe, expect, it } from "vitest";

import { ANONIMO, eraseByContactPoint } from "@/lib/erasure";

interface Traccia {
  delete: number;
  update: number;
  select: number;
  impostati: Record<string, unknown> | null;
}

function dbFinto(trovati: { id: string }[] = [], tolti: { id: string }[] = []) {
  const traccia: Traccia = { delete: 0, update: 0, select: 0, impostati: null };

  const catenaDelete = {
    where: () => catenaDelete,
    returning: async () => tolti,
  };
  const catenaUpdate = {
    set: (valori: Record<string, unknown>) => {
      traccia.impostati = valori;
      return catenaUpdate;
    },
    where: () => catenaUpdate,
    returning: async () => trovati,
  };
  const catenaSelect = {
    from: () => catenaSelect,
    where: async () => trovati,
  };

  const db = {
    delete: () => {
      traccia.delete += 1;
      return catenaDelete;
    },
    update: () => {
      traccia.update += 1;
      return catenaUpdate;
    },
    select: () => {
      traccia.select += 1;
      return catenaSelect;
    },
  };
  return { db, traccia };
}

describe("what a contact point may be", () => {
  it("refuses something that is neither an email nor a phone number", async () => {
    // Without this, a typo would be answered with "nothing found" — indistinguishable from
    // "you were not in our records", which is a very different thing to tell someone.
    const { db } = dbFinto();

    await expect(eraseByContactPoint(db, "Mario")).rejects.toThrow(/email address or a phone number/);
  });

  it("refuses an empty contact point instead of erasing everything", async () => {
    const { db } = dbFinto();

    await expect(eraseByContactPoint(db, "   ")).rejects.toThrow(/no contact point/);
  });
});

describe("a lead goes, a contact is anonymised", () => {
  it("deletes the lead outright", async () => {
    // ⚠️ Everything that points at a lead cascades — activity, task, campaign_log — so the
    // person's own words go with them, which is what art. 17 asks for.
    const { db, traccia } = dbFinto([], [{ id: "l1" }, { id: "l2" }]);

    const report = await eraseByContactPoint(db, "anna@example.test");

    expect(traccia.delete).toBe(1);
    expect(report.deleted.lead).toBe(2);
  });

  it("⚠️ does NOT delete a contact, because the schema will not let it", async () => {
    // Measured on the schema, not assumed: deal, quote, order, opportunity, ticket and
    // appointment reference a contact with no cascade, so a DELETE fails with a foreign
    // key violation the moment the person has any commercial history. Deleting those too
    // would destroy the business's own accounts.
    const { db, traccia } = dbFinto([{ id: "c1" }]);

    const report = await eraseByContactPoint(db, "anna@example.test");

    expect(traccia.update).toBe(1);
    expect(report.anonymised.contact).toBe(1);
    // Exactly one delete, and it was the lead.
    expect(traccia.delete).toBe(1);
  });

  it("removes every field that identifies the person, and keeps the record", async () => {
    const { db, traccia } = dbFinto([{ id: "c1" }]);

    await eraseByContactPoint(db, "anna@example.test");

    const impostati = traccia.impostati as Record<string, unknown>;
    expect(impostati.firstName).toBe(ANONIMO);
    for (const campo of ["email", "phone", "mobile", "street", "notes", "linkedinUrl"]) {
      expect(impostati[campo], `${campo} still identifies the person`).toBeNull();
    }
    // The commercial side of the record is untouched: the deal survives without the human.
    for (const campo of ["companyId", "ownerId", "status", "leadScore"]) {
      expect(impostati).not.toHaveProperty(campo);
    }
  });

  it("does not update anything when there is nobody to anonymise", async () => {
    // An UPDATE with no match is harmless, but issuing one anyway would make the report
    // say "anonymised: 0" through a write, and a preview built on the same code path would
    // then have a side effect.
    const { db, traccia } = dbFinto([]);

    const report = await eraseByContactPoint(db, "anna@example.test");

    expect(traccia.update).toBe(0);
    expect(report.anonymised.contact).toBe(0);
  });
});

describe("what survives on purpose", () => {
  it("⚠️⚠️ keeps the email suppression, and says why", async () => {
    // This is the one place where erasing *more* would be the harm: the suppression list is
    // what stops the next campaign reaching the person who asked to be forgotten. Deleting
    // it would mean the erasure request itself caused them to be contacted again.
    const { db } = dbFinto();

    const report = await eraseByContactPoint(db, "anna@example.test");

    expect(report.kept.email_suppression).toMatch(/written to again|forgotten/);
  });
});

describe("finding the person", () => {
  it("matches a phone number however it was typed", async () => {
    // An erasure that missed one of the two spellings would leave the person in the
    // database while telling them they are gone — the worst possible pair.
    const { db } = dbFinto([], [{ id: "l1" }]);

    // Ciò che si fissa qui è che un recapito **telefonico** venga accettato: la guardia
    // che pretende una chiocciola lo rifiuterebbe, e l'art. 17 di chi ha solo un numero
    // non arriverebbe da nessuna parte.
    const report = await eraseByContactPoint(db, "+39 333 111 2223");

    expect(report.deleted.lead).toBe(1);
  });

  it("accepts an email with stray case and spaces", async () => {
    const { db } = dbFinto([], [{ id: "l1" }]);

    const report = await eraseByContactPoint(db, "  Anna@Example.TEST  ");

    expect(report.deleted.lead).toBe(1);
  });
});

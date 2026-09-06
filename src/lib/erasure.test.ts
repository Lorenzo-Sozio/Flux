/**
 * Erasing a person: the shape of the operation, without a database.
 *
 * What is pinned here is what the code **decides** — which trails it removes, which it
 * strips the person out of, which it leaves alone, and in what **order** — because those
 * are the decisions that turn a 200 into a true or a false statement to someone who asked
 * to be forgotten.
 *
 * The database handle is a double that records the calls it was given. That is enough to
 * pin the decisions and it runs in milliseconds, so it runs before every commit; a test
 * that needs a seeded tenant is a test that gets skipped on the day it matters.
 */
import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { ANONIMO, eraseByContactPoint } from "@/lib/erasure";

interface Chiamata {
  verbo: "select" | "delete" | "update";
  tabella: string;
  impostati?: Record<string, unknown>;
}

/**
 * A double that **declares** what it returns, rather than inheriting a fallback.
 *
 * `presenti` decides whether the person exists: without it every test would only exercise
 * the case where nobody does — which is the case where nothing happens.
 */
function dbFinto(presenti = true) {
  const chiamate: Chiamata[] = [];
  // ⚠️ `getTableName` rather than reading it by hand: drizzle keeps the name behind a
  // symbol, and a guessed access returned "?" for all of them — meaning every assertion in
  // this file would have passed against any table at all.
  const nome = (t: unknown) => getTableName(t as Parameters<typeof getTableName>[0]);

  const righe = presenti ? [{ id: "x1" }] : [];

  const db = {
    select: () => ({
      from: (t: unknown) => {
        chiamate.push({ verbo: "select", tabella: nome(t) });
        return { where: async () => righe };
      },
    }),
    delete: (t: unknown) => {
      chiamate.push({ verbo: "delete", tabella: nome(t) });
      const c = { where: () => c, returning: async () => righe };
      return c;
    },
    update: (t: unknown) => {
      const chiamata: Chiamata = { verbo: "update", tabella: nome(t) };
      chiamate.push(chiamata);
      const c = {
        set: (valori: Record<string, unknown>) => {
          chiamata.impostati = valori;
          return c;
        },
        where: () => c,
        returning: async () => righe,
      };
      return c;
    },
  };
  return { db, chiamate };
}

const EMAIL = "anna@example.test";

describe("what a contact point may be", () => {
  it("refuses something that is neither an email nor a phone number", async () => {
    // Without this, a typo would be answered with "nothing found" — indistinguishable from
    // "you were not in our records", which is a very different thing to tell someone.
    const { db } = dbFinto();

    await expect(eraseByContactPoint(db, "Mario")).rejects.toThrow(/email address or a phone number/);
  });

  it("refuses an empty contact point instead of erasing everybody", async () => {
    const { db } = dbFinto();

    await expect(eraseByContactPoint(db, "   ")).rejects.toThrow(/no contact point/);
  });
});

describe("⚠️⚠️ the order, which is the part that makes the rest true", () => {
  it("finds the person BEFORE changing anything", async () => {
    const { db, chiamate } = dbFinto();

    await eraseByContactPoint(db, EMAIL);

    const primaScrittura = chiamate.findIndex((c) => c.verbo !== "select");
    const letture = chiamate.slice(0, primaScrittura).map((c) => c.tabella);
    expect(letture).toContain("lead");
    expect(letture).toContain("contact");
  });

  it("anonymises the contact LAST, after every trail has been dealt with", async () => {
    // This is the bug the first version had: anonymising the contact first destroys the
    // index — from that moment nothing else can be found from the contact point — so the
    // trails were left both present and unreachable. A repeat request could not have been
    // honoured, and neither could an audit.
    const { db, chiamate } = dbFinto();

    await eraseByContactPoint(db, EMAIL);

    const scritture = chiamate.filter((c) => c.verbo !== "select");
    const ultima = scritture[scritture.length - 1];
    expect(ultima.tabella).toBe("contact");
    expect(ultima.verbo).toBe("update");
    // ...and there was actually something before it, or this test proves nothing.
    expect(scritture.length).toBeGreaterThan(5);
    // ⚠️ **Once only**: without this line, anonymising the contact at the start as well —
    // that is, burning the index — would pass, because it would still happen at the end.
    const suContact = scritture.filter((c) => c.tabella === "contact");
    expect(suContact).toHaveLength(1);
  });
});

describe("the trails that survive anonymising a contact, and must not", () => {
  it("removes the diary written about that person", async () => {
    // ⚠️ `activity` and `task` cascade from a *lead*, never from an anonymised *contact*:
    // the cascade only fires on a delete. Their free text is the person's own story, and
    // rewriting free text always leaves something behind.
    const { db, chiamate } = dbFinto();

    const report = await eraseByContactPoint(db, EMAIL);

    const cancellate = chiamate.filter((c) => c.verbo === "delete").map((c) => c.tabella);
    expect(cancellate).toContain("activity");
    expect(cancellate).toContain("task");
    expect(report.deleted.activity).toBe(1);
  });

  it("removes the sending queue, which carries the address and the body", async () => {
    const { db, chiamate } = dbFinto();

    await eraseByContactPoint(db, EMAIL);

    const cancellate = chiamate.filter((c) => c.verbo === "delete").map((c) => c.tabella);
    expect(cancellate).toContain("campaign_log");
    expect(cancellate).toContain("email_job");
  });

  it("removes the IP address left by opening a quote", async () => {
    // An IP address is personal data. This table answers «was the quote opened?», and that
    // fact survives without knowing who.
    const { db, chiamate } = dbFinto();

    await eraseByContactPoint(db, EMAIL);

    expect(chiamate.filter((c) => c.verbo === "delete").map((c) => c.tabella)).toContain("quote_activity");
  });

  it("keeps the case and removes the person's words from it", async () => {
    // A ticket is a business record: it happened, on a date, with an outcome. What the
    // person wrote inside it is not.
    const { db, chiamate } = dbFinto();

    await eraseByContactPoint(db, EMAIL);

    const ticket = chiamate.find((c) => c.tabella === "ticket" && c.verbo === "update");
    expect(ticket?.impostati?.description).toBeNull();
    expect(ticket?.impostati?.subject).toBe(ANONIMO);

    const messaggio = chiamate.find((c) => c.tabella === "ticket_message");
    expect(messaggio?.impostati?.senderEmail).toBeNull();
    expect(messaggio?.impostati?.content).toBe("");
  });

  it("keeps the appointment and removes who was at it", async () => {
    const { db, chiamate } = dbFinto();

    await eraseByContactPoint(db, EMAIL);

    const presenza = chiamate.find((c) => c.tabella === "appointment_attendee");
    expect(presenza?.impostati?.email).toBeNull();
    expect(presenza?.impostati?.name).toBe(ANONIMO);
  });
});

describe("a lead goes, a contact is anonymised", () => {
  it("deletes the lead outright", async () => {
    const { db, chiamate } = dbFinto();

    const report = await eraseByContactPoint(db, EMAIL);

    expect(chiamate.filter((c) => c.verbo === "delete").map((c) => c.tabella)).toContain("lead");
    expect(report.deleted.lead).toBe(1);
  });

  it("⚠️ does NOT delete a contact, because the schema will not let it", async () => {
    // Measured on the schema, not assumed: deal, quote, order, opportunity, ticket and
    // appointment reference a contact with no cascade, so a DELETE fails with a foreign
    // key violation the moment the person has any commercial history.
    const { db, chiamate } = dbFinto();

    await eraseByContactPoint(db, EMAIL);

    expect(chiamate.filter((c) => c.verbo === "delete").map((c) => c.tabella)).not.toContain("contact");
  });

  it("removes every field that identifies the person, and keeps the relationship", async () => {
    const { db, chiamate } = dbFinto();

    await eraseByContactPoint(db, EMAIL);

    // ⚠️ The verb matters too: on `contact` there is a **read** first — the step that
    // finds the person before touching them — and searching by table alone caught that one.
    const impostati = chiamate.find((c) => c.tabella === "contact" && c.verbo === "update")?.impostati as Record<
      string,
      unknown
    >;
    expect(impostati.firstName).toBe(ANONIMO);
    for (const campo of ["email", "phone", "mobile", "street", "notes", "linkedinUrl"]) {
      expect(impostati[campo], `${campo} still identifies the person`).toBeNull();
    }
    // The commercial side of the record is untouched: the deal survives without the human.
    for (const campo of ["companyId", "ownerId", "status", "leadScore"]) {
      expect(impostati).not.toHaveProperty(campo);
    }
  });

  it("touches nothing linked to a contact when there is no contact", async () => {
    // A person may exist only as a lead. Issuing the updates anyway would make the report
    // claim work that never happened.
    const { db, chiamate } = dbFinto(false);

    const report = await eraseByContactPoint(db, EMAIL);

    expect(chiamate.filter((c) => c.tabella === "contact" && c.verbo === "update")).toHaveLength(0);
    expect(report.anonymised.contact).toBe(0);
    expect(report.deleted.activity).toBe(0);
  });
});

describe("what survives on purpose", () => {
  it("⚠️⚠️ keeps the email suppression, and says why", async () => {
    // The one place where erasing *more* would be the harm: the suppression list is what
    // stops the next campaign reaching the person who asked to be forgotten. Deleting it
    // would mean the erasure request itself caused them to be contacted again.
    const { db } = dbFinto();

    const report = await eraseByContactPoint(db, EMAIL);

    expect(report.kept.email_suppression).toMatch(/written to again|forgotten/);
  });

  it("lists the internal discussion instead of rewriting it", async () => {
    // An algorithm editing a conversation either destroys its meaning or leaves the name
    // in. Listing it puts the decision where it belongs — with a person.
    const { db } = dbFinto();

    const report = await eraseByContactPoint(db, EMAIL);

    const voce = Object.keys(report.kept).find((k) => k.includes("deal_comment"));
    expect(voce, "the internal discussion is not declared anywhere").toBeDefined();
    expect(report.kept[voce as string]).toMatch(/case by case|person can decide/);
  });
});

describe("finding the person", () => {
  it("accepts a phone-only contact point", async () => {
    // The guard that insists on an at-sign would reject it, and the erasure of somebody
    // who only ever gave a number would never happen.
    const { db } = dbFinto();

    const report = await eraseByContactPoint(db, "+39 333 111 2223");

    expect(report.deleted.lead).toBe(1);
  });

  it("accepts an email with stray case and spaces", async () => {
    const { db } = dbFinto();

    const report = await eraseByContactPoint(db, "  Anna@Example.TEST  ");

    expect(report.deleted.lead).toBe(1);
  });
});

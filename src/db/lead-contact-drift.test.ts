/**
 * Lead and contact hold the same twenty-three columns, and must keep holding them.
 *
 * The audit's M-02 asked for the two tables to be merged and the answer was no,
 * with reasons: seventy-five files name leads, the conversion flow had just been
 * given a transaction and duplicate detection, and the gain is conceptual. The
 * one consequence that could cost something — somebody unsubscribing as a
 * contact and carrying on receiving mail as a lead — is already contained,
 * because the unsubscribe route works on the person and switches consent off
 * everywhere that person appears.
 *
 * What the answer left behind was a date rather than a defect. In its own words:
 * reopen this "the day a new column is added to both tables and one of them
 * forgets — that is the moment the duplication starts to cost".
 *
 * ⚠️ This is that day, arriving as a red test instead of as a bug. A column added
 * to one side and not the other means a field the customer fills on a lead and
 * loses at conversion, or a consent recorded in one place and read from the
 * other. Neither looks like a failure: the field is simply empty afterwards.
 *
 * Updating these lists is the deliberate act. Adding a column to both sides is
 * fine and the diff says so; adding it to one is a decision somebody has to
 * write down here, and the moment to ask whether M-02's answer still holds.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const SCHEMA = "src/db/schema.ts";

/** The property names of one `pgTable` block, in declaration order. */
function columnsOf(table: string): string[] {
  const src = readFileSync(SCHEMA, "utf8").split("\r\n").join("\n");
  const start = src.indexOf(`export const ${table} = pgTable(`);
  if (start === -1) throw new Error(`table ${table} not found in ${SCHEMA}`);
  const end = src.indexOf("\n});", start);
  return [...src.slice(start, end).matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
}

/** Held by both, and the reason the two tables shadow each other. */
const SHARED = [
  "city",
  "consentDate",
  "country",
  "createdAt",
  "email",
  "firstName",
  "groupId",
  "id",
  "jobTitle",
  "lastName",
  "leadScore",
  "marketingConsent",
  "mobile",
  "notes",
  "ownerId",
  "phone",
  "source",
  "state",
  "status",
  "street",
  "tags",
  "updatedAt",
  "zipCode",
];

/** A lead is a person who is not a customer yet, and this is what that adds. */
const LEAD_ONLY = [
  "companyName",
  "convertedAt",
  "convertedToCompanyId",
  "convertedToContactId",
  "convertedToDealId",
  "industry",
  "isConverted",
  "leadCategoryId",
  "leadTypeId",
  "rating",
  "website",
];

/** A contact belongs to a company and came from somewhere. */
const CONTACT_ONLY = ["companyId", "department", "linkedinUrl", "sourceLeadId"];

describe("the columns lead and contact share", () => {
  const lead = columnsOf("leads");
  const contact = columnsOf("contacts");

  it("⚠️ are the same twenty-three, and change only on purpose", () => {
    const shared = lead.filter((c) => contact.includes(c));
    expect([...shared].sort()).toEqual([...SHARED].sort());
  });

  it("⚠️ leave the lead exactly what a lead has and a contact does not", () => {
    expect([...lead.filter((c) => !contact.includes(c))].sort()).toEqual([...LEAD_ONLY].sort());
  });

  it("⚠️ leave the contact exactly what a contact has and a lead does not", () => {
    expect([...contact.filter((c) => !lead.includes(c))].sort()).toEqual([...CONTACT_ONLY].sort());
  });

  it("keeps consent on both, because it is read from whichever row is at hand", () => {
    // The one duplicate that could cost something. It is contained by the
    // unsubscribe route working on the person rather than the row, and that only
    // works while both tables actually carry the field.
    for (const column of ["marketingConsent", "consentDate", "email", "phone"]) {
      expect(lead, `lead.${column}`).toContain(column);
      expect(contact, `contact.${column}`).toContain(column);
    }
  });
});

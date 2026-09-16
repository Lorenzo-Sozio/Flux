/**
 * The invoice actions, read as source.
 *
 * ⚠️⚠️ Issuing assigns a number that can never be taken back, and a deleted issued
 * invoice is a gap in a legal sequence. Each line checked here is one whose absence
 * breaks no other test and no screen.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const src = readFileSync("src/actions/invoices.ts", "utf8").split("\r\n").join("\n");

function body(name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name} is gone`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("who may do what", () => {
  for (const [name, capability] of [
    ["createInvoice", "invoice:write"],
    ["getNewInvoiceData", "invoice:write"],
    ["getOrderForInvoice", "invoice:write"],
    ["saveInvoiceDraft", "invoice:write"],
    ["deleteInvoiceDraft", "invoice:write"],
    ["issueInvoiceAction", "invoice:issue"],
    ["archiveInvoiceAction", "invoice:write"],
    ["createCreditNote", "invoice:write"],
    ["sendInvoiceCopy", "invoice:write"],
  ]) {
    it(`⚠️⚠️ ${name} requires ${capability} before touching the database`, () => {
      const b = body(name);
      const guard = b.indexOf(`await requireCapability("${capability}")`);
      expect(guard, "no capability check").toBeGreaterThan(-1);
      expect(guard).toBeLessThan(b.indexOf("getDb()"));
    });
  }
});

describe("drafts", () => {
  it("⚠️⚠️ only a draft can be deleted", () => {
    expect(body("deleteInvoiceDraft")).toContain('and(eq(invoices.id, id), eq(invoices.status, "draft"))');
  });

  it("⚠️⚠️ saving checks the input and bumps the revision conditionally, before touching the lines", () => {
    const b = body("saveInvoiceDraft");
    expect(b).toContain("const cleaned = cleanDraft(input);");
    const bump = b.indexOf('eq(invoices.status, "draft"), eq(invoices.revision, revision)');
    expect(bump, "the bump is not conditional").toBeGreaterThan(-1);
    expect(bump).toBeLessThan(b.indexOf("await writeLines("));
    expect(b).toContain("if (!bumped) return");
  });
});

describe("issuing", () => {
  it("⚠️⚠️ refuses while the issuer, the customer or the draft has anything missing", () => {
    const b = body("issueInvoiceAction");
    const check = b.indexOf("if (blockers.issuer.length || blockers.customer.length || blockers.draft.length)");
    expect(check, "blockers are not checked").toBeGreaterThan(-1);
    expect(check).toBeLessThan(b.indexOf("await issueInvoice("));
  });

  it("⚠️⚠️ numbers through the single issuing statement, with the revision it checked", () => {
    const b = body("issueInvoiceAction");
    expect(b).toContain("await issueInvoice(db, {");
    expect(b).toContain("    revision,\n");
    expect(b).toContain("scope: invoiceScope(invoice.series, fiscalYear)");
    expect(b).toContain("linesSnapshot: final.lines,");
  });

  it("⚠️⚠️ decides the stamp again from the lines being frozen, and freezes the recharge line with them", () => {
    const b = body("issueInvoiceAction");
    const decide = b.indexOf("const final = finalLines(lines, discount, invoice.stampDutyMode, recharge);");
    expect(decide, "the stamp is taken from the draft row instead").toBeGreaterThan(-1);
    expect(decide).toBeLessThan(b.indexOf("await issueInvoice("));
    expect(b).toContain("stampDuty: final.stamp.applied,");
    expect(b).toContain("const totals = totalsOf(final.lines, discount);");
  });

  it("⚠️ refuses a stamp override without a reason", () => {
    expect(body("issueInvoiceAction")).toContain(
      "draft: draftProblems(lines, discount, { mode: invoice.stampDutyMode, note: invoice.stampDutyNote }),",
    );
  });

  it("⚠️ dates the invoice in Italian time, not UTC", () => {
    expect(body("issueInvoiceAction")).toContain("const issueDate = italianToday();");
  });
});

describe("files and the courtesy copy", () => {
  it("⚠️⚠️ archives after issuing, never before and never in the way of the response", () => {
    const b = body("issueInvoiceAction");
    const archive = b.indexOf("after(() =>\n    archiveInvoice(db, id)");
    expect(archive, "the invoice is not archived after issuing").toBeGreaterThan(-1);
    const refused = b.indexOf("if (!result) {");
    expect(refused, "the refusal branch moved: re-read this test").toBeGreaterThan(-1);
    expect(archive).toBeGreaterThan(refused);
    expect(b).not.toContain("await archiveInvoice(");
  });

  it("⚠️⚠️ sends a courtesy copy only of an issued invoice, to a checked address", () => {
    const b = body("sendInvoiceCopy");
    const refuse = b.indexOf('if (invoice.status !== "issued" || !invoice.documentNumber || !invoice.issueDate) {');
    expect(refuse, "a draft could be sent").toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(b.indexOf("await sendInvoiceCopyEmail("));
    expect(b.indexOf("if (!EMAIL.test(address))")).toBeLessThan(b.indexOf("getDb()"));
  });

  it("⚠️ records the sending only once the email went", () => {
    const b = body("sendInvoiceCopy");
    expect(b.indexOf("if (!sent.success) return")).toBeLessThan(b.indexOf("emailedAt: new Date()"));
  });
});

describe("credit notes", () => {
  it("⚠️⚠️ issues a credit note through the statement that takes its amount from the invoice", () => {
    const b = body("issueInvoiceAction");
    expect(b).toContain("creditOf: isCredit ? invoice.originalInvoiceId : null,");
  });

  it("⚠️⚠️ never recharges stamp duty on a credit note, wherever its lines are totalled", () => {
    expect(body("issueInvoiceAction")).toContain(
      "const recharge = isCredit ? false : Boolean(issuer?.rechargeStampDuty);",
    );
    expect(body("getInvoice")).toContain("const recharge = isCredit ? false : Boolean(issuer?.rechargeStampDuty);");
    expect(body("saveInvoiceDraft")).toContain('await rechargesFor(db, current?.documentType ?? "TD01"),');
    expect(body("createCreditNote")).toContain(
      "const final = finalLines(frozen, discount, invoice.stampDutyMode, false);",
    );
  });

  it("⚠️ copies the invoice's issued lines without the stamp recharge, and only from an issued invoice", () => {
    const b = body("createCreditNote");
    expect(b).toContain(".filter((l) => !l.isStampRecharge)");
    expect(
      b.indexOf('if (!room) return { ok: false, error: "Only an issued invoice can be credited." };'),
    ).toBeLessThan(b.indexOf(".insert(invoices)"));
  });
});

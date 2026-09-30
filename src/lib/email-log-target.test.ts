/**
 * An email sent from a record is logged on that record — a lead on the lead.
 *
 * ⚠️⚠️ A lead with no company used to be logged as a contact: the foreign key refused it,
 * after the email had gone, and the person saw an error and sent it again.
 */
import { describe, expect, it } from "vitest";

import { emailLogTarget } from "./email-log-target";

describe("⚠️⚠️ emailLogTarget", () => {
  it("logs on a lead when the page says so, company name or not", () => {
    expect(emailLogTarget({ id: "l1" }, "lead")).toEqual({ leadId: "l1" });
  });

  it("logs on a contact when the page says so", () => {
    expect(emailLogTarget({ id: "c1" }, "contact")).toEqual({ contactId: "c1" });
  });

  it("logs on a company written to at its own address", () => {
    expect(emailLogTarget({ id: "co1", isConverted: false }, "company")).toEqual({ companyId: "co1" });
  });

  it("logs on no person when there is no record of one: the deal logs it", () => {
    expect(emailLogTarget({ id: "" }, "contact")).toEqual({});
  });

  it("without being told, recognises a lead by the field only leads have", () => {
    expect(emailLogTarget({ id: "l1", isConverted: false })).toEqual({ leadId: "l1" });
    expect(emailLogTarget({ id: "c1" })).toEqual({ contactId: "c1" });
  });
});

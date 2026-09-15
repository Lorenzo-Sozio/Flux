/**
 * Contract terms, renewals and recurring revenue.
 *
 * ⚠️ The failures here are renewals nobody is told about and revenue that is not
 * there: both look like ordinary numbers on a screen.
 */
import { describe, expect, it } from "vitest";

import {
  addMonths,
  type ContractTerms,
  cleanContract,
  contractPhase,
  currentTermEnd,
  isDay,
  monthlyRecurringRevenue,
  monthlyValue,
  noticeDeadline,
  termsOf,
  today,
} from "./contract-terms";

const contract = (c: Partial<ContractTerms> = {}): ContractTerms => ({
  status: "active",
  amount: 1200,
  billingPeriod: "annual",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  autoRenew: false,
  renewalTermMonths: null,
  noticeDays: 60,
  ...c,
});

describe("calendar days", () => {
  it("⚠️⚠️ keeps the end of a month at the end of the month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-08-31", 1)).toBe("2026-09-30");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });

  it("goes back across a year", () => {
    expect(addMonths("2026-01-10", -1)).toBe("2025-12-10");
  });

  it("reads today in UTC, whatever the server's zone", () => {
    expect(today(new Date("2026-03-31T23:30:00Z"))).toBe("2026-03-31");
  });

  it("refuses a day that does not exist", () => {
    expect(isDay("2026-02-30")).toBe(false);
    expect(isDay("2026-2-3")).toBe(false);
    expect(isDay("2026-02-28")).toBe(true);
  });
});

describe("where a contract stands", () => {
  it("is active inside its term, before the notice period", () => {
    expect(contractPhase(contract(), "2026-06-01")).toBe("active");
  });

  it("⚠️⚠️ is due for renewal a month before the notice deadline, until the term ends", () => {
    // 60 days' notice on a term ending 31 December: notice must be given by
    // 1 November, so the contract starts asking on 2 October — not on the deadline
    // itself, when there is no time left to act.
    expect(noticeDeadline("2026-12-31", 60)).toBe("2026-11-01");
    expect(contractPhase(contract(), "2026-10-01")).toBe("active");
    expect(contractPhase(contract(), "2026-10-02")).toBe("renewal_due");
    expect(contractPhase(contract(), "2026-12-31")).toBe("renewal_due");
  });

  it("⚠️⚠️ has expired the day after its term, when it does not renew", () => {
    expect(contractPhase(contract(), "2027-01-01")).toBe("expired");
  });

  it("⚠️⚠️ never expires when it renews itself: the term rolls on", () => {
    const c = contract({ autoRenew: true, renewalTermMonths: 12 });
    expect(currentTermEnd(c, "2027-01-01")).toBe("2027-12-31");
    expect(contractPhase(c, "2027-01-01")).toBe("active");
    expect(currentTermEnd(c, "2029-06-01")).toBe("2029-12-31");
  });

  it("⚠️⚠️ is due again before each renewal, not only the first", () => {
    const c = contract({ autoRenew: true, renewalTermMonths: 12 });
    expect(contractPhase(c, "2027-11-01")).toBe("renewal_due");
  });

  it("⚠️ keeps a month-end renewal on the month end, not drifting a day each round", () => {
    const c = contract({ endDate: "2026-01-31", autoRenew: true, renewalTermMonths: 1, noticeDays: 0 });
    expect(currentTermEnd(c, "2026-02-15")).toBe("2026-02-28");
    expect(currentTermEnd(c, "2026-03-15")).toBe("2026-03-31");
  });

  it("the term still on its last day is that term, not the next", () => {
    const c = contract({ autoRenew: true, renewalTermMonths: 12 });
    expect(currentTermEnd(c, "2026-12-31")).toBe("2026-12-31");
  });

  it("is upcoming before it starts, whatever its end", () => {
    expect(contractPhase(contract({ startDate: "2026-09-01" }), "2026-08-31")).toBe("upcoming");
  });

  it("⚠️ follows what a person decided over what the dates say", () => {
    expect(contractPhase(contract({ status: "cancelled" }), "2026-06-01")).toBe("cancelled");
    expect(contractPhase(contract({ status: "draft" }), "2026-06-01")).toBe("draft");
  });

  it("with no end, is simply active and never due", () => {
    expect(contractPhase(contract({ endDate: null }), "2040-01-01")).toBe("active");
  });
});

describe("recurring revenue", () => {
  it("⚠️⚠️ turns every billing period into a monthly figure", () => {
    expect(monthlyValue({ amount: 1200, billingPeriod: "annual" })).toBe(100);
    expect(monthlyValue({ amount: 300, billingPeriod: "quarterly" })).toBe(100);
    expect(monthlyValue({ amount: 600, billingPeriod: "semiannual" })).toBe(100);
    expect(monthlyValue({ amount: "100.00", billingPeriod: "monthly" })).toBe(100);
  });

  it("⚠️⚠️ counts only contracts earning that day", () => {
    const earning = [contract(), contract({ amount: 600, billingPeriod: "semiannual", noticeDays: 0 })];
    const notEarning = [
      contract({ status: "draft" }),
      contract({ status: "cancelled" }),
      contract({ startDate: "2027-01-01", endDate: "2027-12-31" }),
      contract({ startDate: "2025-01-01", endDate: "2025-12-31" }),
    ];
    expect(monthlyRecurringRevenue([...earning, ...notEarning], "2026-06-01")).toBe(200);
  });

  it("⚠️ still counts a contract that is due for renewal: it has not ended", () => {
    expect(monthlyRecurringRevenue([contract()], "2026-12-01")).toBe(100);
  });

  it("rounds to the cent", () => {
    expect(monthlyRecurringRevenue([contract({ amount: 1000 })], "2026-06-01")).toBe(83.33);
  });
});

describe("saving a contract", () => {
  const input = {
    title: " Assistenza 2026 ",
    companyId: "c1",
    status: "active" as const,
    amount: 1200,
    currency: "eur",
    billingPeriod: "annual",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    autoRenew: false,
    noticeDays: 60,
  };

  it("tidies what it stores", () => {
    const r = cleanContract(input);
    expect(r.ok && r.value).toMatchObject({ title: "Assistenza 2026", currency: "EUR", renewalTermMonths: null });
  });

  it("⚠️⚠️ refuses a self-renewing contract with no end, which would never be due", () => {
    expect(cleanContract({ ...input, endDate: null, autoRenew: true, renewalTermMonths: 12 }).ok).toBe(false);
  });

  it("⚠️ refuses a self-renewing contract with no renewal length", () => {
    expect(cleanContract({ ...input, autoRenew: true, renewalTermMonths: 0 }).ok).toBe(false);
  });

  it("⚠️ refuses an end before the start", () => {
    expect(cleanContract({ ...input, endDate: "2025-12-31" }).ok).toBe(false);
  });

  it("refuses an impossible date, a negative amount and an unknown period", () => {
    expect(cleanContract({ ...input, startDate: "2026-02-30" }).ok).toBe(false);
    expect(cleanContract({ ...input, amount: -1 }).ok).toBe(false);
    expect(cleanContract({ ...input, billingPeriod: "weekly" }).ok).toBe(false);
    expect(cleanContract({ ...input, noticeDays: 400 }).ok).toBe(false);
  });

  it("refuses a contract with no company", () => {
    expect(cleanContract({ ...input, companyId: "" }).ok).toBe(false);
  });
});

describe("reading a stored row", () => {
  const row = {
    status: "active",
    amount: "1200.00",
    billingPeriod: "annual",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    autoRenew: false,
    renewalTermMonths: null,
    noticeDays: 60,
  };

  it("keeps the values it was saved with", () => {
    expect(termsOf(row)).toMatchObject({ status: "active", billingPeriod: "annual", amount: "1200.00" });
    expect(termsOf({ ...row, status: "cancelled" }).status).toBe("cancelled");
  });

  it("⚠️ reads an unknown status as active, so it asks for attention instead of disappearing", () => {
    expect(termsOf({ ...row, status: "expired" }).status).toBe("active");
  });
});

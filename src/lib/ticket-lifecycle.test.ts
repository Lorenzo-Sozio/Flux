/**
 * The places a ticket's life is decided, each one line in a file about something else.
 *
 * ⚠️⚠️ Removing any of these breaks no screen: tickets simply arrive without a promise,
 * the board moves them without the owner check, the customer is never told or asked, a
 * late first answer is never recorded, or the customer's page is not reachable. Every
 * report built on top of them then reads fine and says something false.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");

describe("every way a ticket is born carries its SLA", () => {
  it("⚠️⚠️ typed in, by email, from the site, and reopened as a new ticket", () => {
    const support = read("src/actions/support.ts");
    expect(support).toContain("const sla = await resolveSla(db, validated.priority);");
    // The linked ticket a reply to a closed one opens.
    expect(support).toContain("const sla = await resolveSla(db, ticket.priority);");
    expect(read("src/lib/ticket-from-email.ts")).toContain('const sla = await resolveSla(db, "normal");');
    expect(read("src/lib/web-forms.ts")).toContain('const sla = await resolveSla(db, "normal");');
  });
});

describe("one status rule", () => {
  const support = read("src/actions/support.ts");

  it("⚠️⚠️ the board's drag goes through the detail page's action, owner check and all", () => {
    const body = support.slice(support.indexOf("export async function updateTicketStatusAction("));
    expect(body.slice(0, body.indexOf("\n}\n"))).toContain("return updateTicketAction(ticketId, {");
  });

  it("⚠️⚠️ a resolution tells the customer and asks, once", () => {
    expect(support).toContain("if (validated.status && becameResolved(ticket.status, validated.status)) {");
    expect(support).toContain(
      "await requestRating(db, { ticketId, subdomain: tenant?.subdomain ?? null, base: getAppUrlOrNull() })",
    );
  });

  it("⚠️ a customer's email reopens a resolved ticket through the same rule", () => {
    const inbound = read("src/lib/ticket-from-email.ts");
    expect(inbound).toContain(
      'ticket.status === "waiting" || ticket.status === "resolved" ? statusStamps(ticket, "open", now) : null;',
    );
  });
});

describe("a late first answer is recorded", () => {
  it("⚠️⚠️ when it is given late, and while it is still not given", () => {
    expect(read("src/actions/support.ts")).toContain(
      "if (ticket.firstResponseDueAt && answeredAt > ticket.firstResponseDueAt && !ticket.firstResponseBreachedAt) {\n      ticketUpdates.firstResponseBreachedAt = answeredAt;",
    );
    const job = read("src/app/api/cron/ticket-sla-check/route.ts");
    expect(job).toContain(".set({ firstResponseBreachedAt: now })");
    expect(job).toContain("isNull(tickets.firstResponseAt),");
  });
});

describe("the customer's way in", () => {
  it("⚠️⚠️ the proxy lets the status page and the rating through, the rating rate-limited", () => {
    const proxy = read("src/proxy.ts");
    expect(proxy).toContain('if (pathname.startsWith("/t/") || pathname === "/api/tickets/public") {');
    expect(proxy).toContain('!rateLimit(ip, "ticket_rating", 10, 60_000)');
  });

  it("⚠️ a reply carries the link to it, under our own Message-ID", () => {
    const support = read("src/actions/support.ts");
    expect(support).toContain(
      "replyFooterHtml(await ticketLanguage(db, contactId), statusPageUrl(base, tenant.subdomain, token))",
    );
    expect(support).toContain(".set({ emailMessageId: headerId })");
  });
});

/**
 * Reading the `To:` header of an inbound email.
 *
 * On the tested surface because this decides **which customer's database** an
 * inbound email is filed in. Every other entry point that answers that question
 * is tested for the same reason: getting it wrong writes a stranger's message
 * into somebody's CRM, creates a contact record for them there, and looks
 * exactly like the feature working.
 *
 * The header is written by whatever mail system sent it, so it arrives in every
 * shape the RFC allows and a few it does not.
 */
import { describe, expect, it } from "vitest";

import { recipientAddresses } from "./email-parser";

describe("recipientAddresses", () => {
  it("reads a bare address", () => {
    expect(recipientAddresses("support@firm.example")).toEqual(["support@firm.example"]);
  });

  it("discards the display name", () => {
    expect(recipientAddresses("Support Desk <support@firm.example>")).toEqual(["support@firm.example"]);
  });

  it("⚠️ returns every recipient, not just the first", () => {
    // A customer writes to the person they know and copies support. It is the
    // support address that names the workspace, and it is rarely first.
    expect(recipientAddresses("Anna <anna@firm.example>, Support <support@firm.example>")).toEqual([
      "anna@firm.example",
      "support@firm.example",
    ]);
  });

  it("lowercases, because an address is not case sensitive where it matters", () => {
    expect(recipientAddresses("Support@Firm.Example")).toEqual(["support@firm.example"]);
  });

  it("does not repeat an address listed twice", () => {
    expect(recipientAddresses("support@firm.example, Support <SUPPORT@firm.example>")).toEqual([
      "support@firm.example",
    ]);
  });

  it("survives a header with nothing usable in it", () => {
    for (const header of ["", "   ", ",", ", ,", "undisclosed-recipients:;"]) {
      expect(recipientAddresses(header), JSON.stringify(header)).toEqual([]);
    }
  });

  it("ignores the empty entries a trailing comma leaves", () => {
    expect(recipientAddresses("support@firm.example, ")).toEqual(["support@firm.example"]);
  });
});

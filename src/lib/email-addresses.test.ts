import { describe, expect, it } from "vitest";

import { parseAddressList } from "./email-addresses";

describe("parseAddressList", () => {
  it("reads addresses however they are separated, with or without a name", () => {
    expect(parseAddressList("anna@x.it, Luca Bianchi <LUCA@y.com>; marco@z.org  sara@w.it").addresses).toEqual([
      "anna@x.it",
      "luca@y.com",
      "marco@z.org",
      "sara@w.it",
    ]);
  });

  it("⚠️ names what is not an address instead of dropping it silently", () => {
    expect(parseAddressList("anna@x.it, anna, @x.it, luca@y")).toEqual({
      addresses: ["anna@x.it"],
      invalid: ["anna", "@x.it", "luca@y"],
    });
  });

  it("counts the same address once, and an empty field as no copies", () => {
    expect(parseAddressList("anna@x.it, ANNA@x.it").addresses).toEqual(["anna@x.it"]);
    expect(parseAddressList("  ")).toEqual({ addresses: [], invalid: [] });
    expect(parseAddressList(null)).toEqual({ addresses: [], invalid: [] });
  });
});

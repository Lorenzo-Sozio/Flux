/**
 * ⚠️ A bank's CSV (I13): a preamble, Dare / Avere, Italian dates and amounts, a mapping by name.
 */
import { describe, expect, it } from "vitest";

import { guessMapping, missingColumns, parseBankAmount, parseBankDate, readCsv } from "./csv";
import { cleanMovement, fingerprintOf, numberRepeats } from "./movement";

const ROWS = [
  ["Conto corrente", "IT60X0542811101000000123456"],
  ["Periodo", "01/09/2026 - 30/09/2026"],
  [],
  ["Data contabile", "Data valuta", "Dare", "Avere", "Descrizione operazione", "Causale"],
  ["15/09/2026", "16/09/2026", "", "1.220,00", "BONIFICO DA RISTORANTE IL GLICINE SRL SALDO FT 12/2026", "48"],
  ["16/09/2026", "16/09/2026", "35,50", "", "COMMISSIONI", "66"],
  ["17/09/2026", "17/09/2026", "-12,00", "", "BOLLO", "66"],
  ["Saldo finale", "", "", "", "", ""],
];

describe("⚠️ reading a bank's CSV", () => {
  it("finds the header under the preamble and guesses the columns, Dare and Avere included", () => {
    const { headerRow, mapping } = guessMapping(ROWS);
    expect(headerRow).toBe(3);
    expect(mapping).toMatchObject({
      date: "Data contabile",
      valueDate: "Data valuta",
      amount: null,
      credit: "Avere",
      debit: "Dare",
      description: ["Descrizione operazione", "Causale"],
      dateOrder: "dmy",
      decimal: ",",
    });
  });

  it("reads money in as positive and money out as negative, however the bank signs Dare", () => {
    const { headerRow, mapping } = guessMapping(ROWS);
    const read = readCsv(ROWS, headerRow, mapping ?? ({} as never));
    expect(read.movements.map((m) => [m.bookedOn, m.amount, m.valueOn])).toEqual([
      ["2026-09-15", 1220, "2026-09-16"],
      ["2026-09-16", -35.5, "2026-09-16"],
      ["2026-09-17", -12, "2026-09-17"],
    ]);
    expect(read.movements[0].remittance).toBe("BONIFICO DA RISTORANTE IL GLICINE SRL SALDO FT 12/2026 48");
    // The footer has no date: reported, never read as a movement.
    expect(read.problems).toEqual([{ line: 8, problem: "date" }]);
  });

  it("⚠️ asks for the mapping again when a column it names is gone, instead of reading the wrong one", () => {
    const { mapping } = guessMapping(ROWS);
    expect(missingColumns(["Data contabile", "Dare", "Avere"], mapping ?? ({} as never))).toContain("Data valuta");
  });

  it("reads amounts and dates as banks write them", () => {
    expect(parseBankAmount("1.234,56", ",")).toBe(1234.56);
    expect(parseBankAmount("1,234.56", ".")).toBe(1234.56);
    expect(parseBankAmount("1.234,56-", ",")).toBe(-1234.56);
    expect(parseBankAmount("(12,00)", ",")).toBe(-12);
    expect(parseBankAmount("€ 12,00", ",")).toBe(12);
    expect(parseBankAmount("12abc", ",")).toBeNull();
    expect(parseBankDate("15/09/26", "dmy")).toBe("2026-09-15");
    expect(parseBankDate("2026-09-15T10:00", "dmy")).toBe("2026-09-15");
    expect(parseBankDate("09/15/2026", "mdy")).toBe("2026-09-15");
    expect(parseBankDate("31/02/2026", "dmy")).toBeNull();
  });
});

describe("⚠️⚠️ the same line imported twice, and two identical payments", () => {
  const m = { bookedOn: "2026-09-15", amount: 50, currency: "EUR", remittance: "Quota", bankReference: null };

  it("numbers identical lines over the whole file, so two payments stay two and a re-import collides", () => {
    const first = numberRepeats([m, m]).map(fingerprintOf);
    expect(first[0]).not.toBe(first[1]);
    expect(numberRepeats([m, m]).map(fingerprintOf)).toEqual(first);
  });

  it("the server checks every movement again: what the page sends is input like any other", () => {
    expect(cleanMovement({ ...m, bookedOn: "2026-02-30" })).toEqual({ ok: false, problem: "date" });
    expect(cleanMovement({ ...m, amount: 0.001 })).toEqual({ ok: false, problem: "amount" });
    expect(cleanMovement({ ...m, amount: "50" })).toEqual({ ok: false, problem: "amount" });
    expect(cleanMovement({ ...m, currency: "euro" })).toEqual({ ok: false, problem: "currency" });
    const ok = cleanMovement({ ...m, counterpartyIban: "it02 l123 4512 3451 2345 6789 012", repeat: -3 });
    expect(ok.ok && ok.movement.counterpartyIban).toBe("IT02L1234512345123456789012");
    expect(ok.ok && ok.movement.repeat).toBe(1);
  });
});

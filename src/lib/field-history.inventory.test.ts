/**
 * Every save of a deal, contact, company or lead writes its field history.
 *
 * ⚠️ A guarantee each action has to remember is one the next action would not have, and a
 * missing history is invisible by construction: the record saves, and nothing says what it
 * was before. Read as source, like api-write-log's inventory.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function body(file: string, name: string): string {
  const src = readFileSync(file, "utf8").split("\r\n").join("\n");
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name} is gone from ${file}`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

const SAVES: [string, string, string][] = [
  ["src/actions/pipeline.ts", "updateDeal", "deal"],
  ["src/actions/pipeline.ts", "updateDealStage", "deal"],
  ["src/actions/pipeline.ts", "loseDeal", "deal"],
  ["src/actions/crm.ts", "updateContact", "contact"],
  ["src/actions/crm.ts", "updateCompany", "company"],
  ["src/actions/crm.ts", "updateLead", "lead"],
  ["src/actions/orders.ts", "convertQuoteToOrderAction", "deal"],
];

describe("⚠️⚠️ field history is written by every save", () => {
  for (const [file, name, entity] of SAVES) {
    it(`${name} records the ${entity}'s changes`, () => {
      expect(body(file, name)).toContain(`recordFieldChanges(db, "${entity}",`);
    });
  }
});

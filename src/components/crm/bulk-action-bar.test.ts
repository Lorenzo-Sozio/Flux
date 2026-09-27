/**
 * Deleting in bulk is asked first.
 *
 * ⚠️⚠️ One click on "Delete" removed every selected record — and, through the foreign keys,
 * every activity, task and note under them — with no confirmation and no way back.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const src = readFileSync("src/components/crm/bulk-action-bar.tsx", "utf8");

describe("⚠️⚠️ bulk delete", () => {
  it("is reached only through the confirmation dialog's action", () => {
    const calls = [...src.matchAll(/handle\(onDelete\)/g)];
    expect(calls).toHaveLength(1);
    const line = src.split("\n").find((l) => l.includes("handle(onDelete)")) ?? "";
    expect(line).toContain("<AlertDialogAction");
  });

  it("says how many records, and what goes with them", () => {
    expect(src).toContain('t("confirmDeleteTitle", { count })');
    expect(src).toContain('t("confirmDeleteBody")');
  });
});

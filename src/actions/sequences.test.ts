/**
 * The follow-up sequence actions, read as source.
 *
 * ⚠️ A server action is an endpoint whatever the screen shows: one that forgot its
 * own check lets a viewer start emailing customers.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const src = readFileSync("src/actions/sequences.ts", "utf8").split("\r\n").join("\n");

function body(name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name} is gone`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("changing sequences and enrollments", () => {
  for (const [name, capability] of [
    ["saveSequence", "sequence:manage"],
    ["deleteSequence", "sequence:manage"],
    ["enrollRecord", "record:write"],
    ["stopEnrollment", "record:write"],
  ]) {
    it(`⚠️⚠️ ${name} requires ${capability} before touching the database`, () => {
      const b = body(name);
      const guard = b.indexOf(`await requireCapability("${capability}")`);
      expect(guard, "no capability check").toBeGreaterThan(-1);
      expect(guard).toBeLessThan(b.indexOf("getDb()"));
    });
  }

  it("⚠️⚠️ saveSequence stores only what cleanSequence returned", () => {
    const b = body("saveSequence");
    expect(b).toContain("const cleaned = cleanSequence(input);");
    expect(b).toContain("if (!cleaned.ok) return cleaned;");
    expect(b).not.toMatch(/\.\.\.input\b/);
  });

  it("⚠️ saveSequence writes the steps upsert first and deletes the tail after, so an interruption never empties a sequence", () => {
    const b = body("saveSequence");
    const upsert = b.indexOf(".onConflictDoUpdate(");
    const tail = b.indexOf("gte(emailSequenceSteps.position, steps.length)");
    expect(upsert).toBeGreaterThan(-1);
    expect(tail).toBeGreaterThan(upsert);
  });

  it("⚠️ deleteSequence stops the enrollments, cancelling queued email, before the cascade removes them", () => {
    const b = body("deleteSequence");
    expect(b.indexOf("stopEnrollments(")).toBeGreaterThan(-1);
    expect(b.indexOf("stopEnrollments(")).toBeLessThan(b.indexOf(".delete(emailSequences)"));
  });

  it("⚠️ enrolling goes through the runner, which checks suppressions and the unique index", () => {
    expect(body("enrollRecord")).toContain("await enroll(db, {");
  });
});

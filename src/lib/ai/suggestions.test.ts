/**
 * The copilot's log against a real Postgres: what is kept of a call, and who may say what
 * became of the proposal.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

import { decideSuggestion, recordSuggestion } from "./suggestions";
import type { AiResult } from "./types";

const db = drizzle(new PGlite());

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  await db.execute(sql`delete from ai_suggestion`);
});

const OK: AiResult = {
  ok: true,
  text: "Il cliente chiede uno sconto del 10%.",
  truncated: false,
  usage: { inputTokens: 120, outputTokens: 12, reasoningTokens: 0, cachedInputTokens: 0 },
  provider: "gemini",
  model: "gemini-2.5-flash-lite",
};

const FAILED: AiResult = {
  ok: false,
  reason: "rate_limited",
  message: "Gemini answered 429",
  usage: null,
  provider: "gemini",
  model: "gemini-2.5-flash-lite",
};

async function row(id: string) {
  const res = await db.execute(sql`select * from ai_suggestion where id = ${id}`);
  return res.rows[0] as Record<string, unknown>;
}

describe("recordSuggestion", () => {
  it("keeps the proposal as shown, the model and what it cost, pending a decision", async () => {
    const id = await recordSuggestion(db, {
      task: "summary",
      userId: "u1",
      entityType: "deal",
      entityId: "d1",
      result: OK,
      shown: OK.ok ? OK.text : null,
    });
    expect(await row(id)).toMatchObject({
      task: "summary",
      user_id: "u1",
      entity_type: "deal",
      entity_id: "d1",
      provider: "gemini",
      model: "gemini-2.5-flash-lite",
      status: "ok",
      failure_reason: null,
      input_tokens: 120,
      output_tokens: 12,
      text: "Il cliente chiede uno sconto del 10%.",
      outcome: "pending",
    });
  });

  it("logs a failed call with its reason and no text", async () => {
    const id = await recordSuggestion(db, { task: "draft", userId: "u1", result: FAILED, shown: "ignored" });
    expect(await row(id)).toMatchObject({ status: "failed", failure_reason: "rate_limited", text: null });
  });
});

describe("⚠️ decideSuggestion", () => {
  it("is decided once, by whoever asked for it", async () => {
    const id = await recordSuggestion(db, { task: "draft", userId: "u1", result: OK, shown: "bozza" });

    expect(await decideSuggestion(db, id, "u2", "accepted")).toBe(false);
    expect(await decideSuggestion(db, id, "u1", "edited")).toBe(true);
    expect(await decideSuggestion(db, id, "u1", "discarded")).toBe(false);

    const saved = await row(id);
    expect(saved.outcome).toBe("edited");
    expect(saved.decided_at).not.toBeNull();
  });

  it("has nothing to decide on a failed call, or with an outcome that does not exist", async () => {
    const failed = await recordSuggestion(db, { task: "draft", userId: "u1", result: FAILED, shown: null });
    expect(await decideSuggestion(db, failed, "u1", "accepted")).toBe(false);

    const ok = await recordSuggestion(db, { task: "draft", userId: "u1", result: OK, shown: "bozza" });
    expect(await decideSuggestion(db, ok, "u1", "approved" as never)).toBe(false);
  });
});

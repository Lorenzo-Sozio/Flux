/**
 * Closing a deal, against a real Postgres: stage and status move together whichever door
 * the change came through, and the stages that close a deal are configured with rules.
 *
 * ⚠️⚠️ The form had stage and status as two separate fields. A deal moved to "Won" from
 * it stayed `open` and kept weighing on the forecast; one marked won sat in "Proposal";
 * one reopened stayed in the "Lost" column. And converting a quote into an order marked
 * the deal won while leaving its card among the open ones.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";

const pg = drizzle(new PGlite());
// The Neon driver's `batch` is one transaction; statement by statement is enough here.
const db = Object.assign(pg, {
  batch: async (queries: unknown[]) => {
    const out: unknown[] = [];
    for (const q of queries) out.push(await q);
    return out;
  },
});

const actor = { userId: "u1", tenantRole: "admin", isPlatformStaff: false };
vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));
vi.mock("@/lib/auth-guard", () => ({
  requireWriteAccess: async () => ({ user: { id: actor.userId, role: actor.tenantRole } }),
  requireCapability: async () => actor,
  requireAdminAccess: async () => actor,
  requirePlanLimit: async () => undefined,
  requirePlanModule: async () => undefined,
}));
vi.mock("@/lib/exchange-rates", () => ({ getExchangeRates: async () => ({ rates: {} }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k, getFormatter: async () => ({}) }));
vi.mock("@/lib/webhook-dispatch", () => ({ dispatchWebhook: async () => undefined }));
vi.mock("@/components/crm/automation/rule-engine", () => ({ runAutomations: async () => undefined }));
vi.mock("@/lib/notify", () => ({ notify: async () => undefined, notifyMany: async () => undefined }));
vi.mock("@/lib/contact-reach", () => ({ contactReach: async () => ({}) }));
vi.mock("@/lib/workspace-time-zone", () => ({ getWorkspaceTimeZone: async () => "Europe/Rome" }));

const {
  createPipelineAction,
  createPipelineStage,
  deletePipelineAction,
  getDealById,
  getPipelineData,
  getPipelineReport,
  getPipelineStages,
  updateDeal,
  updatePipelineStage,
} = await import("./pipeline");
const { closingStageFor } = await import("@/lib/pipelines");
const { convertQuoteToOrderAction } = await import("./orders");

beforeAll(async () => {
  await applyTenantMigrations(db as never);
}, 120_000);

beforeEach(async () => {
  for (const table of [
    "order_payment",
    "order_item",
    "order",
    "quote_item",
    "quote",
    "task",
    "activity",
    "deal",
    "company",
    "pipeline_stage",
  ]) {
    await db.execute(sql.raw(`delete from "${table}"`));
  }
  await db.execute(sql`
    insert into pipeline_stage (id, name, "order", default_probability, is_won, is_lost) values
      ('s1', 'Qualifica', 1, 10, false, false),
      ('s2', 'Proposta', 2, 50, false, false),
      ('won', 'Vinta', 3, 100, true, false),
      ('lost', 'Persa', 4, 0, false, true)`);
});

async function deal(id: string, stageId: string, status = "open", extra: { lostAtStageId?: string } = {}) {
  await db.execute(sql`
    insert into deal (id, name, stage_id, status, lost_at_stage_id)
    values (${id}, ${id}, ${stageId}, ${status}, ${extra.lostAtStageId ?? null})`);
}

async function row(id: string) {
  const [r] = (await db.execute(sql`select stage_id, status, closed_at, lost_at_stage_id from deal where id = ${id}`))
    .rows as { stage_id: string; status: string; closed_at: Date | null; lost_at_stage_id: string | null }[];
  return r;
}

describe("⚠️⚠️ stage and status move together", () => {
  it("a deal moved into the won column is won", async () => {
    await deal("d1", "s2");
    await updateDeal("d1", { stageId: "won" });

    const r = await row("d1");
    expect(r).toMatchObject({ stage_id: "won", status: "won" });
    expect(r.closed_at).not.toBeNull();
  });

  it("a deal marked lost moves into the lost column, remembering where it stopped", async () => {
    await deal("d1", "s2");
    await updateDeal("d1", { status: "lost" });

    expect(await row("d1")).toMatchObject({ stage_id: "lost", status: "lost", lost_at_stage_id: "s2" });
  });

  it("a lost deal reopened goes back where it stopped, not stays in the lost column", async () => {
    await deal("d1", "lost", "lost", { lostAtStageId: "s2" });
    await updateDeal("d1", { status: "open" });

    const r = await row("d1");
    expect(r).toMatchObject({ stage_id: "s2", status: "open" });
    expect(r.closed_at).toBeNull();
  });

  it("a won deal moved back to an open stage is open again", async () => {
    await deal("d1", "won", "won");
    await updateDeal("d1", { stageId: "s1" });

    expect(await row("d1")).toMatchObject({ stage_id: "s1", status: "open" });
  });

  it("a stage chosen together with a stale status wins over the status", async () => {
    await deal("d1", "s1");
    // The form used to send both; the stage is what the person picked.
    await updateDeal("d1", { stageId: "s2", status: "open" });

    expect(await row("d1")).toMatchObject({ stage_id: "s2", status: "open" });
  });

  it("an edit that touches neither leaves both alone", async () => {
    await deal("d1", "s2");
    await updateDeal("d1", { name: "Renamed" });

    expect(await row("d1")).toMatchObject({ stage_id: "s2", status: "open" });
  });
});

describe("⚠️ converting a quote into an order", () => {
  it("moves the deal into the won column, not only its status", async () => {
    await deal("d1", "s2");
    await db.execute(sql`
      insert into company (id, name) values ('c1', 'Rossi Srl')`);
    await db.execute(sql`insert into "user" (id, email) values ('u1', 'u1@example.com') on conflict do nothing`);
    await db.execute(sql`
      insert into quote (id, quote_number, company_id, deal_id, status, subtotal, total_amount)
      values ('q1', 'Q-1', 'c1', 'd1', 'accepted', '100', '122')`);
    await db.execute(sql`
      insert into quote_item (id, quote_id, description, quantity, unit_price, total_price)
      values (gen_random_uuid()::text, 'q1', 'Riga', '1', '100', '100')`);

    await convertQuoteToOrderAction("q1");

    const [r] = (await db.execute(sql`select stage_id, status, probability from deal where id = 'd1'`)).rows;
    expect(r).toMatchObject({ stage_id: "won", status: "won", probability: 100 });
  });
});

describe("⚠️⚠️ which stages close a deal", () => {
  it("refuses a second won stage", async () => {
    expect(await createPipelineStage({ name: "Vinta bis", kind: "won" })).toEqual({
      ok: false,
      reason: "anotherWon",
    });
    expect(await updatePipelineStage("s1", { kind: "won" })).toEqual({ ok: false, reason: "anotherWon" });
  });

  it("refuses a second lost stage", async () => {
    expect(await updatePipelineStage("s2", { kind: "lost" })).toEqual({ ok: false, reason: "anotherLost" });
  });

  it("refuses to change what a stage means while deals sit in it", async () => {
    await deal("d1", "won", "won");
    expect(await updatePipelineStage("won", { kind: "open" })).toEqual({ ok: false, reason: "hasDeals" });

    const [s] = (await db.execute(sql`select is_won from pipeline_stage where id = 'won'`)).rows;
    expect(s).toEqual({ is_won: true });
  });

  it("moves the meaning once the old column has been given up", async () => {
    expect(await updatePipelineStage("won", { kind: "open" })).toEqual({ ok: true, stage: undefined });
    expect(await updatePipelineStage("s2", { kind: "won" })).toEqual({ ok: true, stage: undefined });

    const flags = (await db.execute(sql`select id, is_won, is_lost from pipeline_stage order by "order"`)).rows;
    expect(flags.filter((f) => f.is_won).map((f) => f.id)).toEqual(["s2"]);
  });

  it("an edit that keeps the kind is not a change of kind", async () => {
    await deal("d1", "won", "won");
    expect(await updatePipelineStage("won", { name: "Chiusa vinta", kind: "won" })).toEqual({
      ok: true,
      stage: undefined,
    });
  });
});

describe("⚠️⚠️ idle days and next step are worked out on read", () => {
  const DAY = 86_400_000;
  const ago = (days: number) => new Date(Date.now() - days * DAY);

  async function signalsOf(id: string) {
    const { deals } = await getPipelineData();
    const onBoard = deals.find((d) => d.id === id)?.signals;
    const onPage = (await getDealById(id))?.signals;
    // One definition: the card and the page must never disagree.
    expect(onPage).toEqual(onBoard);
    return onBoard;
  }

  it("a deal nobody has touched since it was created three weeks ago is idle, with nothing planned", async () => {
    await db.execute(sql`insert into deal (id, name, stage_id, created_at) values ('d1', 'd1', 's1', ${ago(21)})`);

    expect(await signalsOf("d1")).toMatchObject({ idleDays: 21, stalled: true, hasNextStep: false });
  });

  it("⚠️ re-saving the deal is not contact with the customer", async () => {
    await db.execute(
      sql`insert into deal (id, name, stage_id, created_at, updated_at) values ('d1', 'd1', 's1', ${ago(21)}, now())`,
    );

    expect(await signalsOf("d1")).toMatchObject({ idleDays: 21, stalled: true });
  });

  it("a call two days ago makes it two days idle", async () => {
    await db.execute(sql`insert into deal (id, name, stage_id, created_at) values ('d1', 'd1', 's1', ${ago(40)})`);
    await db.execute(
      sql`insert into activity (id, type, content, deal_id, date) values (gen_random_uuid()::text, 'call', 'x', 'd1', ${ago(2)})`,
    );

    expect(await signalsOf("d1")).toMatchObject({ idleDays: 2, stalled: false });
  });

  it("⚠️ a meeting booked for next week is a next step, not contact", async () => {
    await db.execute(sql`insert into deal (id, name, stage_id, created_at) values ('d1', 'd1', 's1', ${ago(30)})`);
    const next = new Date(Date.now() + 7 * DAY);
    await db.execute(
      sql`insert into activity (id, type, content, deal_id, date) values (gen_random_uuid()::text, 'meeting', 'x', 'd1', ${next})`,
    );

    const s = await signalsOf("d1");
    expect(s).toMatchObject({ idleDays: 30, stalled: true, hasNextStep: true });
    expect(s?.nextStepAt?.getTime()).toBe(next.getTime());
  });

  it("⚠️ an open task with no due date is a next step", async () => {
    await db.execute(sql`insert into deal (id, name, stage_id) values ('d1', 'd1', 's1')`);
    await db.execute(
      sql`insert into task (id, title, deal_id, status) values (gen_random_uuid()::text, 'Richiamare', 'd1', 'todo')`,
    );

    expect(await signalsOf("d1")).toMatchObject({ hasNextStep: true, nextStepAt: null });
  });

  it("a task already done is not", async () => {
    await db.execute(sql`insert into deal (id, name, stage_id) values ('d1', 'd1', 's1')`);
    await db.execute(
      sql`insert into task (id, title, deal_id, status) values (gen_random_uuid()::text, 'Richiamato', 'd1', 'done')`,
    );

    expect(await signalsOf("d1")).toMatchObject({ hasNextStep: false });
  });
});

describe("⚠️ a save leaves its history", () => {
  it("records who moved the deal, from which stage to which", async () => {
    await db.execute(sql`delete from field_change`);
    await deal("d1", "s1");
    await updateDeal("d1", { stageId: "s2" });

    const rows = (
      await db.execute(sql`select field, old_value, new_value, changed_by from field_change order by field`)
    ).rows;
    expect(rows).toEqual([{ field: "stageId", old_value: "s1", new_value: "s2", changed_by: "u1" }]);
  });
});

describe("⚠️⚠️ what the board loads", () => {
  const DAY = 86_400_000;
  const ago = (days: number) => new Date(Date.now() - days * DAY);

  beforeEach(async () => {
    await db.execute(sql`delete from field_change`);
    await db.execute(sql`insert into company (id, name) values ('c1', 'Rossi Srl') on conflict do nothing`);
    await db.execute(sql`
      insert into deal (id, name, stage_id, status, closed_at, company_id, created_at) values
        ('open', 'Aperta', 's1', 'open', null, 'c1', ${ago(20)}),
        ('recent', 'Vinta da poco', 'won', 'won', ${ago(10)}, null, ${ago(50)}),
        ('old', 'Persa da tempo', 'lost', 'lost', ${ago(40)}, null, ${ago(90)})`);
  });

  it("with no status asked for: the open deals and those closed in the last month, not every deal ever", async () => {
    const { deals } = await getPipelineData();
    expect(deals.map((d) => d.id).sort()).toEqual(["open", "recent"]);
  });

  it("everything of a status when that status is asked for", async () => {
    const { deals } = await getPipelineData({ status: "lost" });
    expect(deals.map((d) => d.id)).toEqual(["old"]);
  });

  it("⚠️⚠️ closed in a calendar period: exactly the deals a scorecard figure counted, on the workspace's clock", async () => {
    await db.execute(sql`
      insert into deal (id, name, stage_id, status, closed_at) values
        ('sept', 'Settembre', 'won', 'won', '2025-09-15T10:00:00Z'),
        -- 00:30 on 1 October in Rome: October, though UTC still says September.
        ('midnight', 'Mezzanotte', 'won', 'won', '2025-09-30T22:30:00Z'),
        ('aug', 'Agosto', 'won', 'won', '2025-08-31T21:59:00Z'),
        ('sept-lost', 'Persa', 'lost', 'lost', '2025-09-20T10:00:00Z')`);

    const won = await getPipelineData({ status: "won", closed: "2025-09" });
    expect(won.deals.map((d) => d.id)).toEqual(["sept"]);
    // Without a status, the period alone: whatever closed then, won or lost — and nothing open.
    const closed = await getPipelineData({ closed: "2025-09" });
    expect(closed.deals.map((d) => d.id).sort()).toEqual(["sept", "sept-lost"]);
    expect((await getPipelineData({ status: "won", closed: "2025-Q4" })).deals.map((d) => d.id)).toEqual(["midnight"]);
  });

  it("⚠️ counts days in the stage from the last move, not from creation", async () => {
    await db.execute(sql`
      insert into field_change (id, entity_type, entity_id, field, old_value, new_value, changed_at)
      values ('f1', 'deal', 'open', 'stageId', 's2', 's1', ${ago(3)})`);
    const { deals } = await getPipelineData();
    const open = deals.find((d) => d.id === "open");
    expect(open).toMatchObject({ daysInStage: 3, companyName: "Rossi Srl" });
  });

  it("from creation for a deal that has never moved", async () => {
    const { deals } = await getPipelineData();
    expect(deals.find((d) => d.id === "open")?.daysInStage).toBe(20);
  });
});

describe("⚠️⚠️ the stage history the report and the board read", () => {
  const DAY = 86_400_000;
  const ago = (days: number) => new Date(Date.now() - days * DAY);

  beforeEach(async () => {
    await db.execute(sql`delete from field_change`);
    // Created 30 days ago in s1, moved to s2 three days ago.
    await db.execute(
      sql`insert into deal (id, name, stage_id, status, amount, created_at) values ('moved', 'Spostata', 's2', 'open', '1000', ${ago(30)})`,
    );
    await db.execute(sql`
      insert into field_change (id, entity_type, entity_id, field, old_value, new_value, changed_at)
      values ('h1', 'deal', 'moved', 'stageId', 's1', 's2', ${ago(3)})`);
  });

  it("days in a stage are the time spent in it, not the deal's age", async () => {
    const report = await getPipelineReport();
    const byStage = Object.fromEntries(report.stageReport.map((r) => [r.id, r]));
    expect(byStage.s1.avgDaysInStage).toBe(27);
    // Still in s2: no finished stay to average yet.
    expect(byStage.s2.avgDaysInStage).toBeNull();
    expect(byStage.s1.conversion).toBe(100);
  });

  it("⚠️ past its stage's threshold, a deal is flagged stuck on the board and counted in the report", async () => {
    expect((await getPipelineData()).deals.find((d) => d.id === "moved")?.stale).toBe(false);
    await updatePipelineStage("s2", { staleAfterDays: 2 });
    expect((await getPipelineData()).deals.find((d) => d.id === "moved")?.stale).toBe(true);
    const report = await getPipelineReport();
    expect(report.stageReport.find((r) => r.id === "s2")?.stale).toBe(1);
  });

  it("a closing stage holds no threshold", async () => {
    await updatePipelineStage("won", { staleAfterDays: 3 });
    const [row] = (await db.execute(sql`select stale_after_days from pipeline_stage where id = 'won'`)).rows;
    expect(row).toEqual({ stale_after_days: null });
  });
});

describe("⚠️⚠️ more than one pipeline", () => {
  beforeEach(async () => {
    await db.execute(sql`delete from pipeline where id <> 'default'`);
    await db.execute(sql`insert into pipeline (id, name, "order") values ('renew', 'Rinnovi', 1)`);
    await db.execute(sql`
      insert into pipeline_stage (id, name, "order", default_probability, is_won, is_lost, pipeline_id) values
        ('r1', 'Da rinnovare', 1, 50, false, false, 'renew'),
        ('rwon', 'Rinnovato', 2, 100, true, false, 'renew'),
        ('rlost', 'Non rinnovato', 3, 0, false, true, 'renew')`);
    await deal("nuovo", "s1");
    await deal("rinnovo", "r1");
  });

  // The pipelines outlive the stages the file's own setup clears; nothing after this block expects them.
  afterEach(async () => {
    await db.execute(sql`delete from pipeline where id <> 'default'`);
  });

  it("the board shows one pipeline: the first by default, another when asked, all side by side on request", async () => {
    const first = await getPipelineData();
    expect(first.pipelineId).toBe("default");
    expect(first.stages.map((st) => st.id)).toEqual(["s1", "s2", "won", "lost"]);
    expect(first.deals.map((d) => d.id)).toEqual(["nuovo"]);

    const renewals = await getPipelineData({ pipeline: "renew" });
    expect(renewals.stages.map((st) => st.id)).toEqual(["r1", "rwon", "rlost"]);
    expect(renewals.deals.map((d) => d.id)).toEqual(["rinnovo"]);

    const all = await getPipelineData({ pipeline: "all" });
    expect(all.stages).toHaveLength(7);
    expect(all.stages.find((st) => st.id === "r1")?.pipelineName).toBe("Rinnovi");
    expect(all.deals.map((d) => d.id).sort()).toEqual(["nuovo", "rinnovo"]);
  });

  it("⚠️⚠️ a renewal closes into the renewals' own columns, not the first ones in the workspace", async () => {
    expect(await closingStageFor(db, "r1", "won")).toMatchObject({ id: "rwon" });
    expect(await closingStageFor(db, "s1", "won")).toMatchObject({ id: "won" });
    await updateDeal("rinnovo", { status: "lost" });
    expect(await row("rinnovo")).toMatchObject({ status: "lost", stage_id: "rlost" });
  });

  it("⚠️ one won and one lost column per pipeline — not per workspace", async () => {
    // The renewals already have a won column.
    expect(await createPipelineStage({ name: "Chiuso", kind: "won", pipelineId: "renew" })).toMatchObject({
      ok: false,
    });
    const created = await createPipelineAction("Servizi");
    if (!created.ok) throw new Error("pipeline");
    const stages = (await getPipelineStages()).filter((st) => st.pipelineId === created.id);
    expect(stages.filter((st) => st.isWon)).toHaveLength(1);
    expect(stages.filter((st) => st.isLost)).toHaveLength(1);
    // Named when there is more than one pipeline to tell apart.
    expect(stages[0].pipelineName).toBe("Servizi");
  });

  it("the report reads one pipeline's stages and deals", async () => {
    const report = await getPipelineReport({ pipeline: "renew" });
    expect(report.stageReport.map((r) => r.id)).toEqual(["r1", "rwon", "rlost"]);
    expect(report.openCount).toBe(1);
  });

  it("⚠️ a pipeline goes only when it is empty, and the first one never", async () => {
    expect(await deletePipelineAction("default")).toEqual({ ok: false, reason: "default" });
    expect(await deletePipelineAction("renew")).toEqual({ ok: false, reason: "hasDeals" });
    await db.execute(sql`delete from deal where id = 'rinnovo'`);
    expect(await deletePipelineAction("renew")).toEqual({ ok: true });
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from pipeline_stage where pipeline_id = 'renew'`))
      .rows as { n: number }[];
    expect(n).toBe(0);
  });
});

describe("⚠️ the board opens on the deals of whoever is looking", () => {
  it("writes `owners=<me>` into the URL when none is given, and leaves `all` alone", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/(main)/dashboard/pipeline/page.tsx", "utf8");
    expect(src).toContain("if (params.owners === undefined) {");
    expect(src).toContain('next.set("owners", actor.userId);');
  });
});

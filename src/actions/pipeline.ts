"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { and, asc, count, eq, getTableColumns, gte, ilike, inArray, lt, or, type SQL, sql } from "drizzle-orm";
import { getFormatter, getTranslations } from "next-intl/server";

import { runAutomations } from "@/components/crm/automation/rule-engine";
import {
  companies,
  contacts,
  dealLossReasons,
  deals,
  fieldChanges,
  pipelineStages,
  pipelines,
  salesTargets,
  users,
} from "@/db/schema";
import { DEFAULT_STAGES } from "@/db/seed-workspace";
import { requireCapability, requirePlanLimit, requireWriteAccess } from "@/lib/auth-guard";
import { periodBounds } from "@/lib/calendar-period";
import { contactReach } from "@/lib/contact-reach";
import { dealAmountForStorage } from "@/lib/deal-amount";
import { dealSignals, lastActivityByDeal, nextStepByDeal } from "@/lib/deal-signals";
import { getExchangeRates } from "@/lib/exchange-rates";
import { recordFieldChanges } from "@/lib/field-history";
import { closedBetween, dealEur } from "@/lib/metrics";
import { daysBetween } from "@/lib/next-actions";
import { notify } from "@/lib/notify";
import { type DealStatusFilter, ownerCondition, periodStart } from "@/lib/pipeline-filters";
import {
  closingStageFor,
  DEFAULT_PIPELINE_ID,
  listPipelines,
  type PipelineRow,
  pipelineOfStage,
  resolvePipelineId,
  stageIdsOfPipeline,
  stagesOfPipeline,
} from "@/lib/pipelines";
import { countRecords } from "@/lib/record-count";
import { isStale, type StageChange, salesVelocity, stageFigures } from "@/lib/stage-history";
import { checkStageKind, flagsOf, type StageKind, type StageKindRefusal } from "@/lib/stage-kind";
import { getDb } from "@/lib/tenant-context";
import { dispatchWebhook } from "@/lib/webhook-dispatch";
import { getWorkspaceTimeZone } from "@/lib/workspace-time-zone";

export async function getPipelineData(
  filters: {
    owners?: string[];
    status?: DealStatusFilter | null;
    q?: string;
    closed?: string | null;
    /** A pipeline's id, or "all" for every pipeline's columns side by side (src/lib/pipelines.ts). */
    pipeline?: string | null;
  } = {},
) {
  await requireCapability("record:read");
  const db = await getDb();
  // Closed within a calendar period: the deals a figure on the scorecard counted.
  // The stages, the pipelines and the clock at once: they were read in turn on every board visit.
  let [stages, pipelineList, timeZone] = await Promise.all([
    db.select().from(pipelineStages).orderBy(pipelineStages.order),
    listPipelines(db),
    filters.closed ? getWorkspaceTimeZone() : Promise.resolve(null),
  ]);
  const closedIn = filters.closed && timeZone ? periodBounds(filters.closed, timeZone) : null;

  // Seed default stages if pipeline is completely empty.
  //
  // This used to write its own five stages, none of them marked won or lost, so
  // a workspace that first reached the pipeline through this path got a board
  // with no way to close anything. It now uses the same defaults every other
  // path seeds (audit rilievo U-12).
  if (stages.length === 0) {
    await db.insert(pipelineStages).values(DEFAULT_STAGES);
    stages = await db.select().from(pipelineStages).orderBy(pipelineStages.order);
  }

  // One pipeline's columns — or, asked for "all" (a figure opening the deals it counted
  // across the workspace), every pipeline's, each column saying whose it is.
  const all = filters.pipeline === "all" && pipelineList.length > 1;
  const pipelineId = all ? "all" : (pipelineList.find((p) => p.id === filters.pipeline) ?? pipelineList[0])?.id;
  const pipelineOrder = new Map(pipelineList.map((p, i) => [p.id, { i, name: p.name }]));
  stages = all
    ? [...stages].sort(
        (a, b) =>
          (pipelineOrder.get(a.pipelineId)?.i ?? 0) - (pipelineOrder.get(b.pipelineId)?.i ?? 0) || a.order - b.order,
      )
    : stages.filter((st) => !pipelineId || st.pipelineId === pipelineId);
  const shownStages = stages.map((st) => ({
    ...st,
    pipelineName: all ? (pipelineOrder.get(st.pipelineId)?.name ?? null) : null,
  }));

  const where: (SQL | undefined)[] = [ownerCondition(deals.ownerId, filters.owners ?? [])];
  if (!all) {
    const ids = stages.map((st) => st.id);
    where.push(ids.length ? inArray(deals.stageId, ids) : sql`false`);
  }
  // ⚠️ With no status asked for, the open deals and those closed in the last month — not
  // every deal ever won or lost, which the board used to load on every visit.
  if (filters.status) where.push(eq(deals.status, filters.status));
  else if (!closedIn)
    where.push(or(eq(deals.status, "open"), gte(deals.closedAt, new Date(Date.now() - RECENTLY_CLOSED_DAYS * DAY_MS))));
  if (closedIn) where.push(gte(deals.closedAt, closedIn.from), lt(deals.closedAt, closedIn.to));
  if (filters.q) where.push(ilike(deals.name, `%${filters.q.replace(/[\\%_]/g, "\\$&")}%`));
  // Idle days and next step are worked out here, on every read (src/lib/deal-signals.ts).
  const now = new Date();
  const last = lastActivityByDeal(db, now);
  const next = nextStepByDeal(db, now);
  // When the deal entered its stage: the last stage change in its history (V1.7), or its
  // creation for a deal that has not moved since.
  const stageSince = db
    .select({
      dealId: fieldChanges.entityId,
      at: sql<Date | null>`max(${fieldChanges.changedAt})`.mapWith(fieldChanges.changedAt).as("stage_since"),
    })
    .from(fieldChanges)
    .where(and(eq(fieldChanges.entityType, "deal"), eq(fieldChanges.field, "stageId")))
    .groupBy(fieldChanges.entityId)
    .as("deal_stage_since");
  const rows = await db
    .select({
      ...getTableColumns(deals),
      lastActivityAt: last.at,
      nextStepAt: next.at,
      nextStepCount: next.n,
      stageSince: stageSince.at,
      companyName: companies.name,
    })
    .from(deals)
    .leftJoin(last, eq(last.dealId, deals.id))
    .leftJoin(next, eq(next.dealId, deals.id))
    .leftJoin(stageSince, eq(stageSince.dealId, deals.id))
    .leftJoin(companies, eq(companies.id, deals.companyId))
    .where(and(...where));

  const staleAfter = new Map(
    stages.map((st: { id: string; staleAfterDays: number | null }) => [st.id, st.staleAfterDays]),
  );
  const allDeals = rows.map(({ lastActivityAt, nextStepAt, nextStepCount, stageSince: since, ...deal }) => ({
    ...deal,
    daysInStage: daysBetween(since ?? deal.createdAt, now),
    // Past the threshold its stage sets (src/lib/stage-history.ts).
    stale:
      deal.status === "open" && isStale(daysBetween(since ?? deal.createdAt, now), staleAfter.get(deal.stageId ?? "")),
    signals: dealSignals(
      { createdAt: deal.createdAt, lastActivityAt, nextStepAt, hasNextStep: (nextStepCount ?? 0) > 0 },
      now,
    ),
  }));

  return { stages: shownStages, deals: allDeals, pipelines: pipelineList, pipelineId: pipelineId ?? null };
}

/** How far back the board shows closed deals when no status is asked for. */
const RECENTLY_CLOSED_DAYS = 30;
const DAY_MS = 86_400_000;

/** Today's rates only when a conversion is needed: EUR asks nobody. */
async function storedAmount(typed: unknown, currency: string | null | undefined) {
  const code = (currency || "EUR").toUpperCase();
  const rates = code === "EUR" ? {} : (await getExchangeRates()).rates;
  return dealAmountForStorage(typed as string | number | null | undefined, code, rates);
}

export async function createDeal(data: Partial<typeof deals.$inferInsert>) {
  await requireWriteAccess();
  const db = await getDb();
  if (!data.name || !data.stageId) throw new Error("Name and Stage are required.");

  // Enforce the combined maxRecords quota before inserting
  await requirePlanLimit("maxRecords", await countRecords(db));

  // EUR in `amount`, the figure as typed in `amountOriginal`: see src/lib/deal-amount.ts.
  const payload = {
    ...data,
    ...(await storedAmount(data.amount, data.currency)),
    status: data.status || "open",
  };

  const [newDeal] = await db
    .insert(deals)
    .values(payload as typeof deals.$inferInsert)
    .returning();
  revalidatePath("/dashboard/pipeline");
  dispatchWebhook("deal.created", {
    id: newDeal.id,
    name: newDeal.name,
    amount: newDeal.amount,
    stageId: newDeal.stageId,
    // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
  }).catch(() => {});

  // Run automation rules after response is sent (zero-latency)
  after(() =>
    runAutomations({
      entityType: "deal",
      entityId: newDeal.id,
      event: "onCreate",
      oldData: {},
      newData: newDeal as Record<string, unknown>,
    }),
  );

  return newDeal;
}

/**
 * What a deal carries when it is lost.
 *
 * `lossReasonId` is the part that aggregates; the note is for the detail a list
 * cannot hold, and the competitor for the question every sales meeting asks
 * (audit rilievo S-09).
 */
export interface LossDetails {
  lossReasonId?: string | null;
  lostCompetitor?: string | null;
  note?: string | null;
}

export async function updateDealStage(dealId: string, newStageId: string, loss?: LossDetails) {
  const actor = await requireWriteAccess();
  const db = await getDb();

  // Capture old state BEFORE the update (needed for "changed" operators)
  const [oldDeal] = await db.select().from(deals).where(eq(deals.id, dealId));

  const [stage] = await db
    .select({
      defaultProbability: pipelineStages.defaultProbability,
      isWon: pipelineStages.isWon,
      isLost: pipelineStages.isLost,
    })
    .from(pipelineStages)
    .where(eq(pipelineStages.id, newStageId));

  const [oldStage] = oldDeal?.stageId
    ? await db
        .select({ defaultProbability: pipelineStages.defaultProbability })
        .from(pipelineStages)
        .where(eq(pipelineStages.id, oldDeal.stageId))
    : [undefined];

  // The stage default used to be written unconditionally, so a rep who had set
  // 65% by hand lost it every time the card moved. It is now applied only when the
  // current value is still whatever the previous stage suggested (audit rilievo C-06).
  const currentProbability = oldDeal?.probability ?? null;
  const probabilityWasManual =
    currentProbability !== null && currentProbability !== (oldStage?.defaultProbability ?? 0);

  // Dragging a card into the "Won" column changed the stage and left status at
  // "open", so the deal kept weighing on the forecast for ever. Terminal stages
  // now close the deal, and record when.
  const closing = stage?.isWon ? "won" : stage?.isLost ? "lost" : null;
  // ⚠️ And the reverse. Moving a closed deal back into an open stage left its
  // status at "won" or "lost", so the card sat in "Negotiation" while the
  // forecast ignored it and the win/loss report still counted it. `updateDeal`
  // already reopened on a status change; a stage change is the other door.
  const reopening = !closing && !!stage && !!oldDeal && oldDeal.status !== "open";
  const now = new Date();

  // Where the conversation actually stopped. Not derivable afterwards: the move
  // about to happen overwrites `stageId` with the "Lost" column itself.
  const lostFields =
    closing === "lost"
      ? {
          lostAtStageId: oldDeal?.stageId ?? null,
          ...(loss?.lossReasonId !== undefined ? { lossReasonId: loss.lossReasonId } : {}),
          ...(loss?.lostCompetitor !== undefined ? { lostCompetitor: loss.lostCompetitor } : {}),
          ...(loss?.note !== undefined ? { lostReason: loss.note } : {}),
        }
      : {};

  const [updatedDeal] = await db
    .update(deals)
    .set({
      stageId: newStageId,
      probability: probabilityWasManual ? currentProbability : (stage?.defaultProbability ?? 0),
      ...(closing ? { status: closing, closedAt: now } : {}),
      ...(reopening ? { status: "open", closedAt: null, lostReason: null } : {}),
      ...lostFields,
      updatedAt: now,
    })
    .where(eq(deals.id, dealId))
    .returning();
  await recordFieldChanges(db, "deal", dealId, oldDeal, updatedDeal, actor.user.id);

  dispatchWebhook("deal.stage_changed", {
    id: updatedDeal.id,
    name: updatedDeal.name,
    stageId: newStageId,
    probability: updatedDeal.probability,
    // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
  }).catch(() => {});

  // A deal closed by a drag is closed for the same reasons as one closed from the
  // form, and integrations must hear about it either way.
  if (closing && oldDeal?.status !== closing) {
    // ⚠️⚠️ Who the deal was about travels with the event. Without it a subscriber hears
    // "won" and has no idea whose: our ids mean nothing outside this database, and the
    // assistant on the other side matches people by telephone number and email.
    const reach = await contactReach(db, updatedDeal.contactId);
    dispatchWebhook(closing === "won" ? "deal.won" : "deal.lost", {
      id: updatedDeal.id,
      name: updatedDeal.name,
      amount: updatedDeal.amount,
      currency: updatedDeal.currency,
      ...reach,
      // Why it was lost travels with the event, or there is no win/loss analysis
      // downstream either.
      ...(closing === "lost"
        ? {
            lossReasonId: updatedDeal.lossReasonId,
            competitor: updatedDeal.lostCompetitor,
            note: updatedDeal.lostReason,
          }
        : {}),
      // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
    }).catch(() => {});
  }

  revalidatePath("/dashboard/pipeline");

  after(async () => {
    runAutomations({
      entityType: "deal",
      entityId: updatedDeal.id,
      event: "onUpdate",
      oldData: (oldDeal ?? {}) as Record<string, unknown>,
      newData: updatedDeal as Record<string, unknown>,
    });
  });

  return updatedDeal;
}

/**
 * The stage and status a deal ends up with, from whichever of the two a change asked for.
 *
 *  - A new stage decides the status: a won or lost column closes the deal, an open one
 *    opens it again.
 *  - A new status of won or lost moves the deal to that column, if the pipeline has one.
 *  - Reopening a deal that sits in a closed column moves it back where it stopped (or to
 *    the first open stage).
 */
async function reconcileStageAndStatus(
  db: Awaited<ReturnType<typeof getDb>>,
  oldDeal: typeof deals.$inferSelect | undefined,
  wantedStageId: string | null | undefined,
  wantedStatus: string | undefined,
): Promise<{ status?: string; stageId?: string | null }> {
  // Within the pipeline the deal is in — or is moving into: "the won column" is its own.
  const pipelineId = await pipelineOfStage(db, wantedStageId ?? oldDeal?.stageId);
  const stages = await db
    .select({ id: pipelineStages.id, isWon: pipelineStages.isWon, isLost: pipelineStages.isLost })
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, pipelineId))
    .orderBy(pipelineStages.order);
  const everyStage = await db
    .select({ id: pipelineStages.id, isWon: pipelineStages.isWon, isLost: pipelineStages.isLost })
    .from(pipelineStages);
  const byId = new Map(everyStage.map((s: { id: string; isWon: boolean; isLost: boolean }) => [s.id, s]));
  const terminal = (id: string | null | undefined) => {
    const s = id ? byId.get(id) : undefined;
    return s?.isWon ? "won" : s?.isLost ? "lost" : null;
  };

  if (wantedStageId !== undefined && wantedStageId !== oldDeal?.stageId) {
    const closed = terminal(wantedStageId);
    return { stageId: wantedStageId, status: closed ?? "open" };
  }

  if ((wantedStatus === "won" || wantedStatus === "lost") && wantedStatus !== oldDeal?.status) {
    const column = stages.find((s) => (wantedStatus === "won" ? s.isWon : s.isLost));
    return { status: wantedStatus, ...(column ? { stageId: column.id } : {}) };
  }

  if (wantedStatus === "open" && oldDeal && oldDeal.status !== "open" && terminal(oldDeal.stageId)) {
    const back =
      (oldDeal.lostAtStageId && !terminal(oldDeal.lostAtStageId) ? oldDeal.lostAtStageId : null) ??
      stages.find((s) => !s.isWon && !s.isLost)?.id ??
      oldDeal.stageId;
    return { status: "open", stageId: back };
  }

  return { status: wantedStatus };
}

export async function updateDeal(dealId: string, data: Partial<typeof deals.$inferInsert>) {
  const actor = await requireWriteAccess();
  const db = await getDb();

  // Capture old state BEFORE the update
  const [oldDeal] = await db.select().from(deals).where(eq(deals.id, dealId));

  // ⚠️⚠️ The figure the form sends is the one it showed: `amountOriginal`, in the deal's
  // currency. Converting the EUR `amount` again is what shrank a USD deal on every save.
  const amounts = data.amount !== undefined ? await storedAmount(data.amount, data.currency ?? oldDeal?.currency) : {};

  // ⚠️⚠️ Stage and status move together, whichever of the two was asked for. The form had
  // them as two separate fields: a deal moved to "Won" from it stayed `open` and kept
  // weighing on the forecast, one marked "won" sat in "Proposal", and one reopened stayed
  // in the "Lost" column. Dragging on the board already kept them in step
  // (updateDealStage); this is the same rule for every other door.
  const { status, stageId } = await reconcileStageAndStatus(db, oldDeal, data.stageId, data.status);

  // Record WHEN a deal closed. "Won this month" was derived from updatedAt, so
  // re-saving an old deal moved it into the current month's revenue, and the
  // number people are measured on drifted (audit rilievo C-07).
  const isClosing = (status === "won" || status === "lost") && oldDeal?.status !== status;
  const isReopening = status === "open" && !!oldDeal && oldDeal.status !== "open";

  const payload = {
    ...data,
    ...amounts,
    ...(status !== undefined ? { status } : {}),
    ...(stageId !== undefined ? { stageId } : {}),
    ...(isClosing ? { closedAt: new Date() } : {}),
    // Where it stopped, before the move to the losing column overwrites the stage.
    ...(isClosing && status === "lost" ? { lostAtStageId: oldDeal?.stageId ?? null } : {}),
    ...(isReopening ? { closedAt: null, lostReason: null } : {}),
  };

  const [updatedDeal] = await db
    .update(deals)
    .set(payload as Partial<typeof deals.$inferInsert>)
    .where(eq(deals.id, dealId))
    .returning();
  await recordFieldChanges(db, "deal", dealId, oldDeal, updatedDeal, actor.user.id);
  revalidatePath("/dashboard/pipeline");

  // Only on the transition. Passing status: "won" on any later edit re-fired the
  // event and re-notified the owner, so an integration saw the same deal won
  // several times.
  if (status === "won" && isClosing) {
    // ⚠️⚠️ Who the deal was about travels with the event. Without it a subscriber hears
    // "won" and has no idea whose: our ids mean nothing outside this database, and the
    // assistant on the other side matches people by telephone number and email.
    const reach = await contactReach(db, updatedDeal.contactId);
    dispatchWebhook("deal.won", {
      id: updatedDeal.id,
      name: updatedDeal.name,
      amount: updatedDeal.amount,
      ...reach,
      // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
    }).catch(() => {});
    if (updatedDeal.ownerId) {
      notify({
        userId: updatedDeal.ownerId,
        type: "deal_won",
        key: "dealWon",
        params: { name: updatedDeal.name },
        link: `/dashboard/pipeline/${updatedDeal.id}`,
        // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
      }).catch(() => {});
    }
  } else if (status === "lost" && isClosing) {
    const reach = await contactReach(db, updatedDeal.contactId);
    dispatchWebhook("deal.lost", {
      id: updatedDeal.id,
      name: updatedDeal.name,
      amount: updatedDeal.amount,
      ...reach,
      // Why it was lost travels with the event: without it there is no win/loss
      // analysis anywhere, here or downstream.
      reason: updatedDeal.lostReason,
      // biome-ignore lint/suspicious/noEmptyBlockStatements: fire-and-forget
    }).catch(() => {});
  }

  after(async () => {
    runAutomations({
      entityType: "deal",
      entityId: updatedDeal.id,
      event: "onUpdate",
      oldData: (oldDeal ?? {}) as Record<string, unknown>,
      newData: updatedDeal as Record<string, unknown>,
    });
  });

  return updatedDeal;
}

// ─── Deal Detail ─────────────────────────────────────────────────────────────

export async function getDealById(dealId: string) {
  await requireCapability("record:read");
  const db = await getDb();
  const [row] = await db
    .select({
      deal: deals,
      stageName: pipelineStages.name,
      stageColor: pipelineStages.color,
      companyName: companies.name,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      contactEmail: contacts.email,
      // The deal page offers a call button on a phone; the number is the one fact
      // a rep opening a deal in the car actually needs from the contact.
      contactPhone: contacts.phone,
      contactMobile: contacts.mobile,
      ownerName: users.name,
    })
    .from(deals)
    .leftJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
    .leftJoin(companies, eq(deals.companyId, companies.id))
    .leftJoin(contacts, eq(deals.contactId, contacts.id))
    .leftJoin(users, eq(deals.ownerId, users.id))
    .where(eq(deals.id, dealId));
  if (!row) return null;

  const now = new Date();
  // The same subqueries as the board, narrowed to one deal (Postgres pushes the filter
  // on the grouping column inside them), so the page and the card cannot disagree.
  const lastSq = lastActivityByDeal(db, now);
  const nextSq = nextStepByDeal(db, now);
  const [[last], [step]] = await Promise.all([
    db.select({ at: lastSq.at }).from(lastSq).where(eq(lastSq.dealId, dealId)),
    db.select({ at: nextSq.at, n: nextSq.n }).from(nextSq).where(eq(nextSq.dealId, dealId)),
  ]);
  const signals = dealSignals(
    {
      createdAt: row.deal.createdAt,
      lastActivityAt: last?.at ?? null,
      nextStepAt: step?.at ?? null,
      hasNextStep: (step?.n ?? 0) > 0,
    },
    now,
  );
  return { ...row, signals };
}

// ─── Pipeline Report ──────────────────────────────────────────────────────────
export async function getPipelineReport(
  filters: { owners?: string[]; period?: number; pipeline?: string | null } = {},
) {
  await requireCapability("report:read");
  const db = await getDb();
  // One pipeline at a time: stages of two pipelines in one table would add up columns that
  // mean different things.
  const stages = await stagesOfPipeline(db, await resolvePipelineId(db, filters.pipeline));
  const stageIdList = stages.map((st: { id: string }) => st.id);
  // Open pipeline is what is on the table now, whatever its age; the period applies
  // to what closed, on the day it closed.
  const since = filters.period ? periodStart(filters.period) : null;
  const allDeals = await db
    .select()
    .from(deals)
    .where(
      and(
        ownerCondition(deals.ownerId, filters.owners ?? []),
        since ? or(eq(deals.status, "open"), gte(deals.closedAt, since)) : undefined,
        stageIdList.length ? inArray(deals.stageId, stageIdList) : sql`false`,
      ),
    );
  const now = Date.now();

  // Where each deal has been (src/lib/stage-history.ts): its stage changes, one statement.
  const reportIds = allDeals.map((d) => d.id);
  const changes: { entityId: string; oldValue: string | null; newValue: string | null; changedAt: Date }[] =
    reportIds.length === 0
      ? []
      : await db
          .select({
            entityId: fieldChanges.entityId,
            oldValue: fieldChanges.oldValue,
            newValue: fieldChanges.newValue,
            changedAt: fieldChanges.changedAt,
          })
          .from(fieldChanges)
          .where(
            and(
              eq(fieldChanges.entityType, "deal"),
              eq(fieldChanges.field, "stageId"),
              inArray(fieldChanges.entityId, reportIds),
            ),
          )
          .orderBy(asc(fieldChanges.changedAt));
  const changesByDeal = new Map<string, StageChange[]>();
  for (const c of changes) changesByDeal.set(c.entityId, [...(changesByDeal.get(c.entityId) ?? []), c]);
  const figures = stageFigures(stages, allDeals, changesByDeal, new Date(now));

  const stageReport = stages.map((stage) => {
    const stageDeals = allDeals.filter((d) => d.stageId === stage.id && d.status === "open");
    const totalValue = stageDeals.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);
    const weightedValue = stageDeals.reduce(
      (sum, d) => sum + Number(d.amount ?? 0) * ((d.probability ?? stage.defaultProbability ?? 0) / 100),
      0,
    );
    // ⚠️ Days spent in the stage by the deals that left it — not the deals' age, which is
    // what this used to be. Null until one has left.
    const stage_ = figures[stage.id];
    return {
      id: stage.id,
      name: stage.name,
      color: stage.color,
      dealCount: stageDeals.length,
      totalValue,
      weightedValue,
      avgDaysInStage: stage_?.avgDays ?? null,
      conversion: stage_?.conversion ?? null,
      stale: stage_?.stale ?? 0,
      staleAfterDays: stage.staleAfterDays,
      closing: stage.isWon || stage.isLost,
    };
  });

  const wonDeals = allDeals.filter((d) => d.status === "won");
  const lostDeals = allDeals.filter((d) => d.status === "lost");
  const openDeals = allDeals.filter((d) => d.status === "open");
  const totalWonValue = wonDeals.reduce((s, d) => s + Number(d.amount ?? 0), 0);
  const totalPipeline = openDeals.reduce((s, d) => s + Number(d.amount ?? 0), 0);
  const winRate =
    wonDeals.length + lostDeals.length > 0
      ? ((wonDeals.length / (wonDeals.length + lostDeals.length)) * 100).toFixed(1)
      : "0";

  const cycles = wonDeals
    .filter((d) => d.closedAt)
    .map((d) => ((d.closedAt as Date).getTime() - new Date(d.createdAt).getTime()) / 86_400_000);
  const velocity = salesVelocity({
    openCount: openDeals.length,
    wonCount: wonDeals.length,
    lostCount: lostDeals.length,
    wonValue: totalWonValue,
    cycleDays: cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : null,
  });

  return {
    stageReport,
    totalWonValue,
    totalPipeline,
    winRate,
    velocity,
    cycleDays: cycles.length ? Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length) : null,
    wonCount: wonDeals.length,
    lostCount: lostDeals.length,
    openCount: openDeals.length,
  };
}

// ── Pipeline Stage Management ────────────────────────────────────────────────

/**
 * Every stage, in each pipeline's order — with the pipeline's name when there is more than
 * one, so a picker can tell two "Qualification" columns apart (src/lib/pipelines.ts).
 */
export async function getPipelineStages() {
  await requireCapability("record:read");
  const db = await getDb();
  const [stages, list] = await Promise.all([
    db.select().from(pipelineStages).orderBy(pipelineStages.order),
    listPipelines(db),
  ]);
  const position = new Map(list.map((p, i) => [p.id, { i, name: p.name }]));
  const several = list.length > 1;
  return [...stages]
    .sort((a, b) => (position.get(a.pipelineId)?.i ?? 0) - (position.get(b.pipelineId)?.i ?? 0) || a.order - b.order)
    .map((stage) => ({ ...stage, pipelineName: several ? (position.get(stage.pipelineId)?.name ?? null) : null }));
}

/** A threshold as stored: whole days between 1 and 365, or null for none. */
function cleanStaleDays(value: number | null | undefined): number | null {
  const n = Math.round(Number(value));
  return value != null && Number.isFinite(n) && n > 0 ? Math.min(n, 365) : null;
}

export type StageWriteResult<T = undefined> = { ok: true; stage: T } | { ok: false; reason: StageKindRefusal };

export async function createPipelineStage(data: {
  name: string;
  color?: string;
  defaultProbability?: number;
  kind?: StageKind;
  staleAfterDays?: number | null;
  pipelineId?: string;
}): Promise<StageWriteResult<typeof pipelineStages.$inferSelect>> {
  await requireCapability("pipeline:manage");
  const db = await getDb();
  // One won and one lost column per pipeline, not per workspace.
  const pipelineId = await resolvePipelineId(db, data.pipelineId);
  const stages = await stagesOfPipeline(db, pipelineId);
  const kind = data.kind ?? "open";
  const refusal = checkStageKind(stages, null, kind, 0);
  if (refusal) return { ok: false, reason: refusal };

  const maxOrder = stages.length > 0 ? Math.max(...stages.map((s) => s.order)) : 0;
  const [stage] = await db
    .insert(pipelineStages)
    .values({
      name: data.name.trim(),
      pipelineId,
      order: maxOrder + 1,
      color: data.color ?? "#94a3b8",
      defaultProbability: data.defaultProbability ?? 0,
      // Only an open stage can hold a deal long enough to be stuck in it.
      staleAfterDays: kind === "open" ? cleanStaleDays(data.staleAfterDays) : null,
      ...flagsOf(kind),
    })
    .returning();
  revalidatePath("/dashboard/pipeline");
  revalidatePath("/dashboard/settings/pipeline");
  return { ok: true, stage };
}

export async function updatePipelineStage(
  id: string,
  data: {
    name?: string;
    color?: string;
    defaultProbability?: number;
    order?: number;
    kind?: StageKind;
    staleAfterDays?: number | null;
  },
): Promise<StageWriteResult> {
  await requireCapability("pipeline:manage");
  const db = await getDb();
  const { kind, staleAfterDays, ...rest } = data;

  if (kind !== undefined) {
    const stages = await db
      .select({ id: pipelineStages.id, isWon: pipelineStages.isWon, isLost: pipelineStages.isLost })
      .from(pipelineStages)
      .where(eq(pipelineStages.pipelineId, await pipelineOfStage(db, id)));
    const [{ n }] = await db.select({ n: count() }).from(deals).where(eq(deals.stageId, id));
    const refusal = checkStageKind(stages, id, kind, Number(n));
    if (refusal) return { ok: false, reason: refusal };
  }

  // Only an open stage holds a threshold: the kind it is becoming, or the one it has.
  let closing = kind !== undefined && kind !== "open";
  if (kind === undefined && staleAfterDays !== undefined) {
    const [current] = await db
      .select({ isWon: pipelineStages.isWon, isLost: pipelineStages.isLost })
      .from(pipelineStages)
      .where(eq(pipelineStages.id, id));
    closing = Boolean(current?.isWon || current?.isLost);
  }

  await db
    .update(pipelineStages)
    .set({
      ...rest,
      ...(kind !== undefined ? flagsOf(kind) : {}),
      ...(staleAfterDays !== undefined || closing
        ? { staleAfterDays: closing ? null : cleanStaleDays(staleAfterDays) }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(pipelineStages.id, id));
  revalidatePath("/dashboard/pipeline");
  revalidatePath("/dashboard/settings/pipeline");
  return { ok: true, stage: undefined };
}

export async function deletePipelineStage(id: string) {
  await requireCapability("pipeline:manage");
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(deals).where(eq(deals.stageId, id));
  if (Number(n) > 0) {
    throw new Error("Cannot delete a stage with active deals.");
  }
  await db.delete(pipelineStages).where(eq(pipelineStages.id, id));
  revalidatePath("/dashboard/pipeline");
  revalidatePath("/dashboard/settings/pipeline");
}

export async function getDealsForSelect() {
  await requireCapability("record:read");
  const db = await getDb();
  return db.select({ id: deals.id, name: deals.name }).from(deals).orderBy(deals.name);
}

// ── Forecast ──────────────────────────────────────────────────────────────────

export async function getForecastData(filters: { owners?: string[]; pipeline?: string | null } = {}) {
  await requireCapability("report:read");
  const db = await getDb();
  const [format, tFilters] = await Promise.all([getFormatter(), getTranslations("pipeline.filters")]);
  const owners = filters.owners ?? [];
  const openDeals = await db
    .select({
      id: deals.id,
      name: deals.name,
      amount: deals.amount,
      currency: deals.currency,
      probability: deals.probability,
      expectedCloseDate: deals.expectedCloseDate,
      ownerId: deals.ownerId,
      ownerName: users.name,
      stageId: deals.stageId,
      stageName: pipelineStages.name,
      stageProbability: pipelineStages.defaultProbability,
    })
    .from(deals)
    .leftJoin(users, eq(deals.ownerId, users.id))
    .leftJoin(pipelineStages, eq(deals.stageId, pipelineStages.id))
    .where(
      and(
        eq(deals.status, "open"),
        ownerCondition(deals.ownerId, owners),
        inArray(deals.stageId, await stageIdsOfPipeline(db, await resolvePipelineId(db, filters.pipeline))),
      ),
    );

  // Build monthly buckets for the next 6 months
  const now = new Date();
  const periodKeys: string[] = [];
  const months: {
    label: string;
    year: number;
    month: number;
    period: string;
    committed: number;
    bestCase: number;
    pipeline: number;
    target: number;
  }[] = [];

  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    periodKeys.push(period);
    months.push({
      label: format.dateTime(d, { month: "short", year: "numeric" }),
      year: d.getFullYear(),
      month: d.getMonth(),
      period,
      committed: 0,
      bestCase: 0,
      pipeline: 0,
      target: 0,
    });
  }

  // Fetch monthly targets for this period range
  const targetRows = await db
    .select({ period: salesTargets.period, targetAmount: salesTargets.targetAmount })
    .from(salesTargets)
    // A target belongs to a person, so filtered to agents it is their targets only;
    // "nobody" has none.
    .where(and(inArray(salesTargets.period, periodKeys), ownerCondition(salesTargets.userId, owners)));

  for (const tr of targetRows) {
    const bucket = months.find((m) => m.period === tr.period);
    if (bucket) bucket.target += parseFloat(tr.targetAmount ?? "0");
  }

  // Deals that do not belong to any of the six months.
  //
  // Both of these used to be dumped into the LAST bucket, so a future month
  // appeared inflated with dead pipeline and deals whose close date had already
  // passed were presented as revenue six months out (audit rilievo C-08). They are
  // now reported separately, because each is a list of work rather than a forecast:
  // one needs a date, the other needs a decision.
  const unscheduled = { count: 0, weighted: 0, total: 0 };
  const overdue = { count: 0, weighted: 0, total: 0 };
  const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Single pass: bucket by month and build owner map simultaneously
  const ownerMap = new Map<string, { name: string; weighted: number; dealCount: number }>();
  for (const deal of openDeals) {
    const amt = Number(deal.amount ?? 0);
    // The stage's probability when the deal has none of its own — as the pipeline report
    // and the finance page weight it. This used 0, so the same deal counted in one and
    // vanished from the other.
    const prob = deal.probability ?? deal.stageProbability ?? 0;
    const weighted = (amt * prob) / 100;

    let bucket: (typeof months)[number] | null = null;
    if (!deal.expectedCloseDate) {
      unscheduled.count += 1;
      unscheduled.weighted += weighted;
      unscheduled.total += amt;
    } else {
      const cd = new Date(deal.expectedCloseDate);
      const found = months.find((m) => m.year === cd.getFullYear() && m.month === cd.getMonth());
      if (found) {
        bucket = found;
      } else if (cd < startOfCurrentMonth) {
        overdue.count += 1;
        overdue.weighted += weighted;
        overdue.total += amt;
      } else {
        // Genuinely beyond the horizon: counted, but not folded into month six.
        unscheduled.count += 1;
        unscheduled.weighted += weighted;
        unscheduled.total += amt;
      }
    }

    if (bucket) {
      bucket.pipeline += weighted;
      // "Best case" and "committed" are the full value of the deals that qualify,
      // not the probability-weighted value. Weighting them as well discounted the
      // two lines management reads twice over.
      if (prob >= 50) bucket.bestCase += amt;
      if (prob >= 80) bucket.committed += amt;
    }

    if (deal.ownerId) {
      const existing = ownerMap.get(deal.ownerId);
      if (existing) {
        existing.weighted += weighted;
        existing.dealCount += 1;
      } else {
        ownerMap.set(deal.ownerId, { name: deal.ownerName ?? tFilters("unnamed"), weighted, dealCount: 1 });
      }
    }
  }

  // Amounts are stored in EUR, so the figures are EUR. Labelling them with the
  // currency of whichever deal happened to be first in the list presented euro
  // totals as dollars (audit rilievo C-08).
  const currency = "EUR";
  // months[0] is always the current month (loop starts at i=0)
  const currentMonthTarget = months[0]?.target ?? 0;

  // ⚠️ What this month's target is measured against: what has already been won this month
  // plus what is committed to close in it. It used to divide six months of commitments by
  // one month's target, leaving out everything already won.
  const [wonRow] = await db
    .select({ revenue: sql<number>`coalesce(sum(${dealEur}), 0)` })
    .from(deals)
    .where(and(closedBetween("won", startOfCurrentMonth), ownerCondition(deals.ownerId, owners)));
  const wonThisMonth = Number(wonRow?.revenue ?? 0);

  return {
    months,
    unscheduled,
    overdue,
    byOwner: [...ownerMap.values()].sort((a, b) => b.weighted - a.weighted),
    currency,
    totalWeighted: months.reduce((s, m) => s + m.pipeline, 0),
    committed: months.reduce((s, m) => s + m.committed, 0),
    bestCase: months.reduce((s, m) => s + m.bestCase, 0),
    currentMonthTarget,
    currentMonthCommitted: months[0]?.committed ?? 0,
    wonThisMonth,
  };
}

// ─── Why deals are lost ───────────────────────────────────────────────────────

/**
 * The reasons this workspace can pick from.
 *
 * Retired reasons are kept, not deleted: removing one from the list must not
 * erase itself from the deals already closed under it.
 */
export async function getLossReasons(includeRetired = false) {
  await requireCapability("record:read");
  const db = await getDb();
  const rows = await db.select().from(dealLossReasons).orderBy(dealLossReasons.order, dealLossReasons.name);
  return includeRetired ? rows : rows.filter((r) => r.isActive);
}

export async function createLossReason(name: string) {
  await requireCapability("pipeline:manage");
  const db = await getDb();
  const clean = name.trim();
  if (!clean) throw new Error("A reason needs a name.");

  const [{ n }] = await db.select({ n: count() }).from(dealLossReasons);
  const [row] = await db
    .insert(dealLossReasons)
    .values({ name: clean, order: Number(n) + 1 })
    .returning();
  revalidatePath("/dashboard/settings/pipeline");
  return row;
}

export async function updateLossReason(id: string, data: { name?: string; isActive?: boolean; order?: number }) {
  await requireCapability("pipeline:manage");
  const db = await getDb();
  const [row] = await db
    .update(dealLossReasons)
    .set({
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      ...(data.order !== undefined ? { order: data.order } : {}),
    })
    .where(eq(dealLossReasons.id, id))
    .returning();
  revalidatePath("/dashboard/settings/pipeline");
  return row;
}

/**
 * Closes a deal as lost, with the reason attached.
 *
 * Separate from `updateDeal` because losing a deal is not an edit: it is the end
 * of the arc, and the one moment at which the reason is still known. Asked for
 * later, nobody remembers.
 */
export async function loseDeal(dealId: string, loss: LossDetails) {
  const actor = await requireWriteAccess();
  const db = await getDb();

  const [oldDeal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!oldDeal) throw new Error("Deal not found.");
  if (oldDeal.status === "lost") throw new Error("This deal is already closed as lost.");

  // Move it to the losing column if the pipeline has one, so the board agrees
  // with the record. A pipeline without one still closes the deal.
  // Its own pipeline's lost column: the first one in the workspace could be somebody else's.
  const lostStage = await closingStageFor(db, oldDeal.stageId, "lost");

  if (lostStage) return updateDealStage(dealId, lostStage.id, loss);

  const now = new Date();
  const [updated] = await db
    .update(deals)
    .set({
      status: "lost",
      closedAt: now,
      lostAtStageId: oldDeal.stageId,
      lossReasonId: loss.lossReasonId ?? null,
      lostCompetitor: loss.lostCompetitor ?? null,
      lostReason: loss.note ?? null,
      updatedAt: now,
    })
    .where(eq(deals.id, dealId))
    .returning();
  await recordFieldChanges(db, "deal", dealId, oldDeal, updated, actor.user.id);

  const reach = await contactReach(db, updated.contactId);
  dispatchWebhook("deal.lost", {
    id: updated.id,
    name: updated.name,
    amount: updated.amount,
    currency: updated.currency,
    ...reach,
    lossReasonId: updated.lossReasonId,
    competitor: updated.lostCompetitor,
    note: updated.lostReason,
  });

  revalidatePath("/dashboard/pipeline");
  return updated;
}

/**
 * Win/loss, cut the three ways the question is actually asked.
 *
 * By reason, so the pattern is visible; by the stage where it stopped, which says
 * whether the problem is qualification or closing; and by competitor, which is
 * what every sales meeting asks first. All three carry value, not just counts,
 * because ten small losses and one large one are different problems.
 */
export async function getWinLossAnalysis(sinceDays = 365, owners: string[] = [], pipeline: string | null = null) {
  await requireCapability("report:read");
  const db = await getDb();
  const since = periodStart(sinceDays);
  const t = await getTranslations("pipeline.winLoss");

  const closed = await db
    .select({
      id: deals.id,
      status: deals.status,
      amount: deals.amount,
      closedAt: deals.closedAt,
      lossReasonId: deals.lossReasonId,
      lostCompetitor: deals.lostCompetitor,
      lostAtStageId: deals.lostAtStageId,
    })
    .from(deals)
    .where(
      and(
        inArray(deals.status, ["won", "lost"]),
        gte(deals.closedAt, since),
        ownerCondition(deals.ownerId, owners),
        inArray(deals.stageId, await stageIdsOfPipeline(db, await resolvePipelineId(db, pipeline))),
      ),
    );

  const [reasons, stages] = await Promise.all([
    db.select().from(dealLossReasons),
    db.select({ id: pipelineStages.id, name: pipelineStages.name }).from(pipelineStages),
  ]);
  const reasonName = new Map(reasons.map((r) => [r.id, r.name]));
  const stageName = new Map(stages.map((s) => [s.id, s.name]));

  const won = closed.filter((d) => d.status === "won");
  const lost = closed.filter((d) => d.status === "lost");
  const value = (rows: typeof closed) => rows.reduce((sum, d) => sum + Number(d.amount ?? 0), 0);

  /** Groups losses by a key, keeping both the count and the money. */
  const groupLosses = (keyOf: (d: (typeof closed)[number]) => string) => {
    const buckets = new Map<string, { key: string; count: number; value: number }>();
    for (const d of lost) {
      const key = keyOf(d);
      const bucket = buckets.get(key) ?? { key, count: 0, value: 0 };
      bucket.count += 1;
      bucket.value += Number(d.amount ?? 0);
      buckets.set(key, bucket);
    }
    return [...buckets.values()].sort((a, b) => b.value - a.value || b.count - a.count);
  };

  return {
    wonCount: won.length,
    lostCount: lost.length,
    wonValue: value(won),
    lostValue: value(lost),
    // Of everything that actually closed. Open deals are not a loss yet, and
    // counting them as one is how a win rate quietly becomes meaningless.
    winRate: closed.length ? Math.round((won.length / closed.length) * 100) : 0,
    byReason: groupLosses((d) =>
      d.lossReasonId ? (reasonName.get(d.lossReasonId) ?? t("unknown")) : t("notRecorded"),
    ),
    byStage: groupLosses((d) =>
      d.lostAtStageId ? (stageName.get(d.lostAtStageId) ?? t("unknown")) : t("notRecorded"),
    ),
    byCompetitor: groupLosses((d) => d.lostCompetitor?.trim() || t("noneNamed")),
  };
}

// ── Pipelines ─────────────────────────────────────────────────────────────────

/** The workspace's pipelines, in order (src/lib/pipelines.ts). */
export async function getPipelines(): Promise<PipelineRow[]> {
  await requireCapability("record:read");
  return listPipelines(await getDb());
}

const MAX_PIPELINE_NAME = 80;

/**
 * A new pipeline, with the default stages — a won and a lost column included, so a deal in
 * it can be closed from the first day, as in a new workspace.
 */
export async function createPipelineAction(name: string): Promise<{ ok: true; id: string } | { ok: false }> {
  await requireCapability("pipeline:manage");
  const clean = name.trim().slice(0, MAX_PIPELINE_NAME);
  if (!clean) return { ok: false };
  const db = await getDb();
  const existing = await listPipelines(db);
  const id = crypto.randomUUID();
  await db.insert(pipelines).values({ id, name: clean, order: (existing.at(-1)?.order ?? 0) + 1 });
  await db.insert(pipelineStages).values(DEFAULT_STAGES.map((stage) => ({ ...stage, pipelineId: id })));
  revalidatePath("/dashboard/pipeline", "layout");
  revalidatePath("/dashboard/settings/pipeline");
  return { ok: true, id };
}

export async function renamePipelineAction(id: string, name: string): Promise<{ ok: boolean }> {
  await requireCapability("pipeline:manage");
  const clean = name.trim().slice(0, MAX_PIPELINE_NAME);
  if (!clean) return { ok: false };
  await (await getDb()).update(pipelines).set({ name: clean, updatedAt: new Date() }).where(eq(pipelines.id, id));
  revalidatePath("/dashboard/pipeline", "layout");
  revalidatePath("/dashboard/settings/pipeline");
  return { ok: true };
}

/**
 * Deletes a pipeline and its stages — only when no deal stands in any of them, and never
 * the default one, which is where a stage with no say belongs.
 */
export async function deletePipelineAction(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: "default" | "hasDeals" }> {
  await requireCapability("pipeline:manage");
  if (id === DEFAULT_PIPELINE_ID) return { ok: false, reason: "default" };
  const db = await getDb();
  const stageIds = await stageIdsOfPipeline(db, id);
  if (stageIds.length > 0) {
    const [{ n }] = await db.select({ n: count() }).from(deals).where(inArray(deals.stageId, stageIds));
    if (Number(n) > 0) return { ok: false, reason: "hasDeals" };
    await db.delete(pipelineStages).where(eq(pipelineStages.pipelineId, id));
  }
  await db.delete(pipelines).where(eq(pipelines.id, id));
  revalidatePath("/dashboard/pipeline", "layout");
  revalidatePath("/dashboard/settings/pipeline");
  return { ok: true };
}

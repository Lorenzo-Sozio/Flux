import { and, asc, eq, inArray } from "drizzle-orm";

import { pipelineStages, pipelines } from "@/db/schema";

/**
 * More than one pipeline (V3.8): new business and renewals, products and services — each a
 * way of selling with its own stages.
 *
 * ⚠️⚠️ A deal has no pipeline of its own: it is in its stage's. One fact, so nothing has to
 * be kept in step — moving a deal to another pipeline is putting it in one of that
 * pipeline's stages, and every report narrowed to a pipeline narrows by its stages.
 *
 * ⚠️⚠️ "The won column" and "the lost column" are per pipeline. Closing a deal — from the
 * board, an order, the API — takes the closing stage of *its* pipeline: the first won stage
 * in the workspace would move a renewal into the new-business board as it closed.
 */

// biome-ignore lint/suspicious/noExplicitAny: Drizzle's database types differ per driver
type AnyDb = any;

export const DEFAULT_PIPELINE_ID = "default";

export interface PipelineRow {
  id: string;
  name: string;
  order: number;
}

export async function listPipelines(db: AnyDb): Promise<PipelineRow[]> {
  return db
    .select({ id: pipelines.id, name: pipelines.name, order: pipelines.order })
    .from(pipelines)
    .orderBy(asc(pipelines.order), asc(pipelines.name));
}

/** The pipeline asked for if it exists, else the first one — the board always shows one. */
export async function resolvePipelineId(db: AnyDb, requested: string | null | undefined): Promise<string> {
  const all = await listPipelines(db);
  return all.find((p) => p.id === requested)?.id ?? all[0]?.id ?? DEFAULT_PIPELINE_ID;
}

/** The pipeline a stage belongs to; the default for a stage that is not there. */
export async function pipelineOfStage(db: AnyDb, stageId: string | null | undefined): Promise<string> {
  if (!stageId) return DEFAULT_PIPELINE_ID;
  const [row] = await db
    .select({ pipelineId: pipelineStages.pipelineId })
    .from(pipelineStages)
    .where(eq(pipelineStages.id, stageId));
  return row?.pipelineId ?? DEFAULT_PIPELINE_ID;
}

/** The stages of one pipeline, in order. */
export async function stagesOfPipeline(db: AnyDb, pipelineId: string): Promise<(typeof pipelineStages.$inferSelect)[]> {
  return db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, pipelineId))
    .orderBy(asc(pipelineStages.order));
}

/** The ids of a pipeline's stages: how a report is narrowed to it. */
export async function stageIdsOfPipeline(db: AnyDb, pipelineId: string): Promise<string[]> {
  const rows: { id: string }[] = await db
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, pipelineId));
  return rows.map((r) => r.id);
}

/**
 * The won — or lost — stage of the pipeline `stageId` is in. Null when that pipeline has
 * none, which leaves the deal closed in the column it stands in rather than moved into
 * somebody else's pipeline.
 */
export async function closingStageFor(
  db: AnyDb,
  stageId: string | null | undefined,
  kind: "won" | "lost",
): Promise<{ id: string; defaultProbability: number | null } | null> {
  const pipelineId = await pipelineOfStage(db, stageId);
  const [row] = await db
    .select({ id: pipelineStages.id, defaultProbability: pipelineStages.defaultProbability })
    .from(pipelineStages)
    .where(
      and(
        eq(pipelineStages.pipelineId, pipelineId),
        kind === "won" ? eq(pipelineStages.isWon, true) : eq(pipelineStages.isLost, true),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** "Pipeline · Stage" labels, when there is more than one pipeline to tell apart. */
export async function stageLabels(db: AnyDb, stageIds: readonly string[]): Promise<Map<string, string>> {
  if (stageIds.length === 0) return new Map();
  const [rows, all] = await Promise.all([
    db
      .select({ id: pipelineStages.id, name: pipelineStages.name, pipelineName: pipelines.name })
      .from(pipelineStages)
      .leftJoin(pipelines, eq(pipelines.id, pipelineStages.pipelineId))
      .where(inArray(pipelineStages.id, [...stageIds])),
    listPipelines(db),
  ]);
  const several = all.length > 1;
  return new Map(
    (rows as { id: string; name: string; pipelineName: string | null }[]).map((r) => [
      r.id,
      several && r.pipelineName ? `${r.pipelineName} · ${r.name}` : r.name,
    ]),
  );
}

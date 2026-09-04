/**
 * seed-workspace.ts — what a workspace needs to exist before anyone uses it.
 *
 * A new workspace opened on an empty pipeline, so the first lead conversion
 * failed with "No pipeline stages found. Please create one first." — a technical
 * message, on a path the user cannot resolve without knowing that the settings
 * page for it is not in the menu (audit rilievi U-12, D-04).
 *
 * Nothing here is a preference. Every value is either something the product
 * cannot run without (a pipeline needs stages) or something every CRM has by
 * default (a support policy per priority). All of it is editable afterwards, and
 * the seed only ever adds: run it twice and the second run does nothing.
 */
import { count } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { companyCategories, companyTypes, dealLossReasons, pipelineStages, slas } from "@/db/schema";

/**
 * Any tenant handle.
 *
 * Generic over the schema so both callers fit: the one that carries the full
 * tenant schema, and the bare handle the migration paths build. Nothing here
 * touches the relational API, only `select` and `insert` against named tables.
 */
// biome-ignore lint/suspicious/noExplicitAny: the schema generic is irrelevant here
type SeedDb = NeonHttpDatabase<any>;

/**
 * The default pipeline.
 *
 * The last two carry `isWon` / `isLost`, which is what makes dragging a card into
 * them actually close the deal — without them the stage changes and the deal stays
 * open for ever (audit rilievo C-06).
 */
const DEFAULT_STAGES = [
  { name: "Qualification", order: 1, color: "#94a3b8", defaultProbability: 10, isWon: false, isLost: false },
  { name: "Discovery", order: 2, color: "#60a5fa", defaultProbability: 25, isWon: false, isLost: false },
  { name: "Proposal", order: 3, color: "#a78bfa", defaultProbability: 50, isWon: false, isLost: false },
  { name: "Negotiation", order: 4, color: "#fbbf24", defaultProbability: 75, isWon: false, isLost: false },
  { name: "Won", order: 5, color: "#34d399", defaultProbability: 100, isWon: true, isLost: false },
  { name: "Lost", order: 6, color: "#f87171", defaultProbability: 0, isWon: false, isLost: true },
];

/**
 * A response policy per priority.
 *
 * Tickets carry a priority from the first day, and without a matching policy the
 * SLA columns stay empty and every support metric reads as zero.
 */
const DEFAULT_SLAS = [
  { name: "Urgent", priority: "urgent", firstResponseTimeMinutes: 30, resolutionTimeMinutes: 240 },
  { name: "High", priority: "high", firstResponseTimeMinutes: 120, resolutionTimeMinutes: 480 },
  { name: "Normal", priority: "normal", firstResponseTimeMinutes: 480, resolutionTimeMinutes: 2880 },
  { name: "Low", priority: "low", firstResponseTimeMinutes: 1440, resolutionTimeMinutes: 5760 },
];

/**
 * Why deals get lost.
 *
 * A list rather than a free-text box, because free text does not aggregate:
 * "price", "Price", "too expensive" and "cost" are four rows in any analysis
 * (audit rilievo S-09). Editable, and every one of these applies to almost any
 * business selling anything.
 */
const DEFAULT_LOSS_REASONS = [
  "Price",
  "Lost to a competitor",
  "No budget",
  "No decision made",
  "Bad timing",
  "Missing feature or capability",
  "Went with an in-house solution",
  "No response",
];

const DEFAULT_COMPANY_TYPES = ["Prospect", "Customer", "Partner", "Supplier"];
const DEFAULT_COMPANY_CATEGORIES = ["Small business", "Mid-market", "Enterprise", "Public sector"];

export interface SeedResult {
  stages: number;
  slas: number;
  lossReasons: number;
  companyTypes: number;
  companyCategories: number;
}

/**
 * Fills in the defaults a workspace cannot start without.
 *
 * Each table is seeded only when it is empty, so this is safe to call on an
 * existing workspace and will not resurrect something the customer deleted on
 * purpose.
 */
export async function seedWorkspace(db: SeedDb): Promise<SeedResult> {
  const result: SeedResult = { stages: 0, slas: 0, lossReasons: 0, companyTypes: 0, companyCategories: 0 };

  const [stageCount] = await db.select({ n: count() }).from(pipelineStages);
  if (Number(stageCount?.n ?? 0) === 0) {
    await db.insert(pipelineStages).values(DEFAULT_STAGES);
    result.stages = DEFAULT_STAGES.length;
  }

  const [slaCount] = await db.select({ n: count() }).from(slas);
  if (Number(slaCount?.n ?? 0) === 0) {
    await db.insert(slas).values(DEFAULT_SLAS);
    result.slas = DEFAULT_SLAS.length;
  }

  const [reasonCount] = await db.select({ n: count() }).from(dealLossReasons);
  if (Number(reasonCount?.n ?? 0) === 0) {
    await db.insert(dealLossReasons).values(DEFAULT_LOSS_REASONS.map((name, i) => ({ name, order: i + 1 })));
    result.lossReasons = DEFAULT_LOSS_REASONS.length;
  }

  const [typeCount] = await db.select({ n: count() }).from(companyTypes);
  if (Number(typeCount?.n ?? 0) === 0) {
    await db.insert(companyTypes).values(DEFAULT_COMPANY_TYPES.map((name) => ({ name })));
    result.companyTypes = DEFAULT_COMPANY_TYPES.length;
  }

  const [categoryCount] = await db.select({ n: count() }).from(companyCategories);
  if (Number(categoryCount?.n ?? 0) === 0) {
    await db.insert(companyCategories).values(DEFAULT_COMPANY_CATEGORIES.map((name) => ({ name })));
    result.companyCategories = DEFAULT_COMPANY_CATEGORIES.length;
  }

  return result;
}

export { DEFAULT_STAGES, DEFAULT_SLAS, DEFAULT_LOSS_REASONS, DEFAULT_COMPANY_TYPES, DEFAULT_COMPANY_CATEGORIES };

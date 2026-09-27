/**
 * Where each deal has been, and what that says about the pipeline (§6.5): time spent in a
 * stage, how many move on from it, how fast the pipeline turns into revenue, and which
 * open deals are stuck.
 *
 * ⚠️⚠️ Read from the field history (`field_change`, field `stageId`, V1.7), which every
 * move of a deal writes. The report's "average days in stage" was the deal's *age* —
 * `now − createdAt` — so a deal created a year ago and moved into "Proposal" yesterday
 * counted a year of proposal. Now a stay is from entering a stage to leaving it; the first
 * stay starts when the deal was created.
 *
 * Pure: the report reads the rows, and this turns them into figures.
 */

const DAY_MS = 86_400_000;

export interface StageChange {
  oldValue: string | null;
  newValue: string | null;
  changedAt: Date;
}

export interface HistoryDeal {
  stageId: string | null;
  status: string;
  createdAt: Date;
  closedAt: Date | null;
}

export interface StageStay {
  stageId: string;
  from: Date;
  /** Null while the deal is still there. */
  to: Date | null;
}

/** The stages a deal has stood in, in order, from its changes sorted oldest first. */
export function stageStays(deal: HistoryDeal, changes: readonly StageChange[]): StageStay[] {
  const stays: StageStay[] = [];
  let current = changes[0]?.oldValue ?? deal.stageId;
  let from = deal.createdAt;
  for (const change of changes) {
    if (current) stays.push({ stageId: current, from, to: change.changedAt });
    current = change.newValue;
    from = change.changedAt;
  }
  // A closed deal's last stay ends when it closed; an open one is still going.
  if (current) stays.push({ stageId: current, from, to: deal.status === "open" ? null : (deal.closedAt ?? null) });
  return stays;
}

export interface StageDef {
  id: string;
  order: number;
  isWon: boolean;
  isLost: boolean;
  staleAfterDays: number | null;
}

export interface StageFigures {
  /** Average days of the stays that ended, null when none has. */
  avgDays: number | null;
  /** Deals that left this stage for a later one or were won, over those that left it at all. */
  conversion: number | null;
  advanced: number;
  dropped: number;
  /** Open deals here past the stage's threshold. */
  stale: number;
}

/** Whether an open deal has sat in its stage longer than the stage allows. */
export function isStale(daysInStage: number, staleAfterDays: number | null | undefined): boolean {
  return staleAfterDays != null && staleAfterDays > 0 && daysInStage > staleAfterDays;
}

export function stageFigures(
  stages: readonly StageDef[],
  deals: readonly (HistoryDeal & { id: string })[],
  changesByDeal: ReadonlyMap<string, readonly StageChange[]>,
  now: Date,
): Record<string, StageFigures> {
  const order = new Map(stages.map((s) => [s.id, s.order]));
  const closing = new Set(stages.filter((s) => s.isWon || s.isLost).map((s) => s.id));
  const out: Record<string, StageFigures> = {};
  const durations: Record<string, number[]> = {};
  for (const s of stages) {
    out[s.id] = { avgDays: null, conversion: null, advanced: 0, dropped: 0, stale: 0 };
    durations[s.id] = [];
  }

  for (const deal of deals) {
    const stays = stageStays(deal, changesByDeal.get(deal.id) ?? []);
    stays.forEach((stay, i) => {
      const figures = out[stay.stageId];
      if (!figures || closing.has(stay.stageId)) return;
      if (stay.to) durations[stay.stageId].push((stay.to.getTime() - stay.from.getTime()) / DAY_MS);
      const later = stays.slice(i + 1);
      const here = order.get(stay.stageId) ?? 0;
      const movedOn = later.some((s) => !closing.has(s.stageId) && (order.get(s.stageId) ?? 0) > here);
      // A deal that was won got past every stage it stood in.
      if (movedOn || deal.status === "won") {
        figures.advanced++;
      } else if (deal.status === "lost" && !later.some((s) => !closing.has(s.stageId))) {
        // Lost while this was the last open stage it stood in.
        figures.dropped++;
      }
      if (deal.status === "open" && stay.to === null) {
        const def = stages.find((s) => s.id === stay.stageId);
        if (isStale((now.getTime() - stay.from.getTime()) / DAY_MS, def?.staleAfterDays)) figures.stale++;
      }
    });
  }

  for (const s of stages) {
    const d = durations[s.id];
    out[s.id].avgDays = d.length ? Math.round(d.reduce((a, b) => a + b, 0) / d.length) : null;
    const decided = out[s.id].advanced + out[s.id].dropped;
    out[s.id].conversion = decided > 0 ? Math.round((out[s.id].advanced / decided) * 100) : null;
  }
  return out;
}

/**
 * Sales velocity, in value per day: open deals × average won value × win rate ÷ average
 * days to win — how much the pipeline turns into revenue each day at the current pace.
 * Null when any part is unknown (nothing decided, nothing won).
 */
export function salesVelocity(input: {
  openCount: number;
  wonCount: number;
  lostCount: number;
  wonValue: number;
  cycleDays: number | null;
}): number | null {
  const decided = input.wonCount + input.lostCount;
  if (input.wonCount === 0 || decided === 0 || !input.cycleDays || input.cycleDays <= 0) return null;
  const avgWon = input.wonValue / input.wonCount;
  const winRate = input.wonCount / decided;
  return (input.openCount * avgWon * winRate) / input.cycleDays;
}

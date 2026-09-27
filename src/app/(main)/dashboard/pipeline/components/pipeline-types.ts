/** A deal as the board and the list read it (src/actions/pipeline.ts, getPipelineData). */
export type Deal = {
  id: string;
  name: string;
  amount: string | null;
  currency: string;
  probability: number | null;
  expectedCloseDate: Date | null;
  stageId: string | null;
  companyId: string | null;
  contactId: string | null;
  ownerId: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  /** Worked out when the board is read (src/lib/deal-signals.ts), never stored. */
  signals: { idleDays: number; stalled: boolean; hasNextStep: boolean; nextStepAt?: Date | string | null };
  companyName?: string | null;
  /** Since the last stage change in the deal's history, or since it was created. */
  daysInStage?: number;
  /** Past the days its stage allows (src/lib/stage-history.ts). */
  stale?: boolean;
};

export type Stage = {
  id: string;
  name: string;
  order: number;
  color: string | null;
  // Which columns end the deal. The board needs to know, because dropping a card
  // into the losing one is the moment to ask why (audit rilievo S-09).
  isWon?: boolean;
  isLost?: boolean;
  /** Set when the board shows every pipeline: whose column this is. */
  pipelineName?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function stageLabel(stage: Pick<Stage, "name" | "pipelineName">) {
  return stage.pipelineName ? `${stage.pipelineName} · ${stage.name}` : stage.name;
}

/**
 * Needs somebody's attention today: open, and either nothing is planned, it has sat
 * in its stage past the stage's limit, nobody has touched it for a while, or the
 * date it was meant to close has gone by. The same signals the cards show, counted.
 */
export function needsAttention(deal: Deal, now = Date.now()) {
  if (deal.status !== "open") return false;
  const overdue = deal.expectedCloseDate ? new Date(deal.expectedCloseDate).getTime() < now : false;
  return !deal.signals.hasNextStep || Boolean(deal.stale) || deal.signals.stalled || overdue;
}

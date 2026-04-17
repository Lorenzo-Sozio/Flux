import { getScoreTier, SCORE_TIER_CONFIG } from "@/lib/lead-score";

interface Props {
  score: number | null | undefined;
  showValue?: boolean;
}

export function LeadScoreBadge({ score, showValue = true }: Props) {
  if (score == null) return null;
  const tier = getScoreTier(score);
  const { label, className } = SCORE_TIER_CONFIG[tier];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
      title={`Lead score: ${score}/100`}
    >
      {showValue && <span className="tabular-nums">{score}</span>}
      <span>{label}</span>
    </span>
  );
}

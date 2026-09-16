import { useTranslations } from "next-intl";

import { getScoreTier, SCORE_TIER_CONFIG } from "@/lib/lead-score";

interface Props {
  score: number | null | undefined;
  showValue?: boolean;
}

export function LeadScoreBadge({ score, showValue = true }: Props) {
  const t = useTranslations("leadScore");
  if (score == null) return null;
  const tier = getScoreTier(score);
  const { className } = SCORE_TIER_CONFIG[tier];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
      title={t("title", { score })}
    >
      {showValue && <span className="tabular-nums">{score}</span>}
      <span>{t(`tiers.${tier}`)}</span>
    </span>
  );
}

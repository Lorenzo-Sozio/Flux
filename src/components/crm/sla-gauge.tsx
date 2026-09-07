/**
 * A percentage on a ring.
 *
 * ⚠️ `percentage` is nullable, and null is not the same as zero. A dial that has
 * nothing to measure has to look different from one measuring badly: this
 * product used to draw 95%, 88% and 92% when there was no data at all, on a card
 * headed "SLA performance", which is a number a person quotes in a meeting.
 */
interface SLAGaugeProps {
  label: string;
  /** null when there is nothing to measure yet. */
  percentage: number | null;
  color?: "green" | "yellow" | "orange" | "red";
  /** Shown in place of the figure when it is null. */
  emptyLabel?: string;
}

const COLOR_MAP: Record<string, string> = {
  green: "#10b981",
  yellow: "#f59e0b",
  orange: "#f97316",
  red: "#ef4444",
};

function resolveColor(percentage: number, override?: "green" | "yellow" | "orange" | "red"): string {
  if (override && override !== "green") return COLOR_MAP[override];
  if (percentage >= 90) return COLOR_MAP.green;
  if (percentage >= 70) return COLOR_MAP.yellow;
  if (percentage >= 50) return COLOR_MAP.orange;
  return COLOR_MAP.red;
}

export function SLAGauge({ label, percentage, color = "green", emptyLabel = "—" }: SLAGaugeProps) {
  const measured = percentage !== null && Number.isFinite(percentage);
  // An unmeasured dial is grey and empty, not green and full.
  const stroke = measured ? resolveColor(percentage as number, color) : "currentColor";
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = measured
    ? circumference - (Math.min(Math.max(percentage as number, 0), 100) / 100) * circumference
    : circumference;

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0 w-14 h-14">
        {/* Decorative: the label and the figure beside it are already text, so a
            screen reader announcing the ring as well would only repeat them. */}
        <svg viewBox="0 0 88 88" className="w-full h-full -rotate-90" aria-hidden="true">
          <circle
            cx="44"
            cy="44"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            className="text-muted/50"
          />
          <circle
            cx="44"
            cy="44"
            r={radius}
            fill="none"
            stroke={stroke}
            className={measured ? undefined : "text-muted/50"}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.5s ease" }}
          />
        </svg>
        <span
          className={`absolute inset-0 flex items-center justify-center font-bold tabular-nums ${
            measured ? "text-[11px]" : "text-[10px] text-muted-foreground"
          }`}
          style={measured ? { color: stroke } : undefined}
        >
          {measured ? `${Math.round(percentage as number)}%` : emptyLabel}
        </span>
      </div>
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

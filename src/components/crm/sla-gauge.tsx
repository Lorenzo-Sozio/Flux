interface SLAGaugeProps {
  label: string;
  percentage: number;
  color?: "green" | "yellow" | "orange" | "red";
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

export function SLAGauge({ label, percentage, color = "green" }: SLAGaugeProps) {
  const stroke = resolveColor(percentage, color);
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(Math.max(percentage, 0), 100) / 100) * circumference;

  return (
    <div className="flex items-center gap-3">
      <div className="relative shrink-0 w-14 h-14">
        <svg viewBox="0 0 88 88" className="w-full h-full -rotate-90">
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
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 0.5s ease" }}
          />
        </svg>
        <span
          className="absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums"
          style={{ color: stroke }}
        >
          {Math.round(percentage)}%
        </span>
      </div>
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

import { AlertTriangle } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

/**
 * The cash figures did not load: said so, with no number standing in for them.
 *
 * ⚠️ Its own module, without the charts beside it: the company page shows it, and importing it
 * from cash-card.tsx put Recharts into every company page for a card with one line of text.
 */
export function CashError({ text }: { text: string }) {
  return (
    <Card className="border-destructive/40">
      <CardContent className="flex items-start gap-3 py-4 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <p>{text}</p>
      </CardContent>
    </Card>
  );
}

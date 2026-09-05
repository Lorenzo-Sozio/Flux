import Link from "next/link";

import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getWinLossAnalysis } from "@/actions/pipeline";
import { requirePageCapability } from "@/lib/page-guard";

import { WinLossFigures } from "./_components/win-loss-figures";

/**
 * Win/loss.
 *
 * The product knew how much had been lost and never why, because the reason was
 * a column nothing wrote (audit rilievo S-09). Cut three ways, because that is
 * how the question gets asked: by reason, which shows the pattern; by the stage
 * where it stopped, which says whether the problem is qualification or closing;
 * and by competitor, which is the first thing any sales meeting wants to know.
 *
 * Every cut carries value as well as count. Ten small losses and one large one
 * are different problems, and a table of counts cannot tell them apart.
 *
 * The heading follows the rest of the site: the way back on its own line above,
 * then the title. It used to sit beside a button, which pushed the title off the
 * left margin every other page in the product starts from — and the figures were
 * formatted as euro regardless of the workspace currency, which is why they now
 * live in a client component like the ones on the sibling pages.
 */
export default async function WinLossPage() {
  await requirePageCapability("report:read");

  const [analysis, t, tp] = await Promise.all([
    getWinLossAnalysis(),
    getTranslations("pipeline.winLoss"),
    getTranslations("pipeline"),
  ]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          href="/dashboard/pipeline"
          className="mb-3 inline-flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {tp("backToPipeline")}
        </Link>
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>

      <WinLossFigures analysis={analysis} />
    </div>
  );
}

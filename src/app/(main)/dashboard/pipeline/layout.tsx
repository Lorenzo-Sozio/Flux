import { type ReactNode, Suspense } from "react";

import { getPipelines } from "@/actions/pipeline";
import { getPipelineMembers } from "@/actions/pipeline-members";
import { PipelineFilterBar } from "@/components/crm/pipeline-filter-bar";
import { requireModuleAccess } from "@/lib/billing/module-guard";

export default async function PipelineLayout({ children }: { children: ReactNode }) {
  await requireModuleAccess("sales");
  // A filter that cannot load its agents still filters by period and status; it
  // does not take the page down with it.
  const [members, pipelines] = await Promise.all([
    getPipelineMembers().catch(() => []),
    getPipelines().catch(() => []),
  ]);
  // ⚠️⚠️ A column, not a document. The board underneath has to fill what is left
  // after the tabs and the filters, and the only honest way to say "what is left" is
  // to let flex work it out: the height used to be `100dvh` minus a number somebody
  // measured once, which was wrong as soon as the filters wrapped onto a second line —
  // the page then scrolled *and* the board scrolled, one inside the other, with a
  // third scrollbar inside every column.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Suspense fallback={null}>
        <PipelineFilterBar members={members} pipelines={pipelines} />
      </Suspense>
      {/* The pages that are documents (forecast, funnel, report, a deal) scroll
          here; the board does not, because it fits by construction.
          ⚠️ `-m-1 p-1`: a card's border is a `ring`, a box-shadow drawn *outside*
          its box, and a scroll container clips whatever lies outside its padding
          box. Flush against the edge, every card on the deal page lost its left,
          right and top border. One pixel of padding would do; four leaves room for
          the focus ring too, and the negative margin gives the space back. */}
      {/* The list view marks `data-sticky-sections` and lets the page scroll instead,
          so its stage headers can stick (see the dashboard layout). */}
      <div className="-m-1 min-h-0 flex-1 overflow-y-auto p-1 has-[[data-sticky-sections]]:overflow-visible">
        {children}
      </div>
    </div>
  );
}

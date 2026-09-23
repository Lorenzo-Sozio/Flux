import { type ReactNode, Suspense } from "react";

import { getPipelineMembers } from "@/actions/pipeline-members";
import { PipelineFilterBar } from "@/components/crm/pipeline-filter-bar";
import { requireModuleAccess } from "@/lib/billing/module-guard";

export default async function PipelineLayout({ children }: { children: ReactNode }) {
  await requireModuleAccess("sales");
  // A filter that cannot load its agents still filters by period and status; it
  // does not take the page down with it.
  const members = await getPipelineMembers().catch(() => []);
  // ⚠️⚠️ A column, not a document. The board underneath has to fill what is left
  // after the tabs and the filters, and the only honest way to say "what is left" is
  // to let flex work it out: the height used to be `100dvh` minus a number somebody
  // measured once, which was wrong as soon as the filters wrapped onto a second line —
  // the page then scrolled *and* the board scrolled, one inside the other, with a
  // third scrollbar inside every column.
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Suspense fallback={null}>
        <PipelineFilterBar members={members} />
      </Suspense>
      {/* The pages that are documents (forecast, funnel, report) scroll here; the
          board does not, because it fits by construction. */}
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

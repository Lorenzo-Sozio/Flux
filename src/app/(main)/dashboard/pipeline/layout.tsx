import { type ReactNode, Suspense } from "react";

import { getPipelineMembers } from "@/actions/pipeline-members";
import { PipelineFilterBar } from "@/components/crm/pipeline-filter-bar";
import { requireModuleAccess } from "@/lib/billing/module-guard";

export default async function PipelineLayout({ children }: { children: ReactNode }) {
  await requireModuleAccess("sales");
  // A filter that cannot load its agents still filters by period and status; it
  // does not take the page down with it.
  const members = await getPipelineMembers().catch(() => []);
  return (
    <>
      <Suspense fallback={null}>
        <PipelineFilterBar members={members} />
      </Suspense>
      {children}
    </>
  );
}

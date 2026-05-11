import type { ReactNode } from "react";

import { requireModuleAccess } from "@/lib/billing/module-guard";

export default async function PipelineLayout({ children }: { children: ReactNode }) {
  await requireModuleAccess("sales");
  return <>{children}</>;
}

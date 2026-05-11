import type { ReactNode } from "react";

import { requireModuleAccess } from "@/lib/billing/module-guard";

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  await requireModuleAccess("marketing");
  return <>{children}</>;
}

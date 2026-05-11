import type { ReactNode } from "react";

import { requireModuleAccess } from "@/lib/billing/module-guard";

export default async function AutomationLayout({ children }: { children: ReactNode }) {
  await requireModuleAccess("automation");
  return <>{children}</>;
}

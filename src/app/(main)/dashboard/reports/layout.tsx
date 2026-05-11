import type { ReactNode } from "react";

import { requireModuleAccess } from "@/lib/billing/module-guard";

export default async function ReportsLayout({ children }: { children: ReactNode }) {
  await requireModuleAccess("reporting");
  return <>{children}</>;
}

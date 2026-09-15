"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { Receipt } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createInvoiceFromOrder } from "@/actions/invoices";
import { Button } from "@/components/ui/button";

/** Opens this order's draft invoice, creating it the first time. */
export function CreateInvoiceButton({ orderId }: { orderId: string }) {
  const t = useTranslations("invoices");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await createInvoiceFromOrder(orderId);
          if (!result.ok) toast.error(result.error);
          else router.push(`/dashboard/sales/invoices/${result.id}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Receipt className="h-3.5 w-3.5" /> {t("createFromOrder")}
    </Button>
  );
}

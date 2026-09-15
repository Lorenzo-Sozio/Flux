import Link from "next/link";
import { notFound } from "next/navigation";

import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getInvoice } from "@/actions/invoices";
import { getActor } from "@/lib/auth-guard";
import { requirePageCapability } from "@/lib/page-guard";
import { can } from "@/lib/permissions";

import { InvoiceView } from "./_components/invoice-view";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageCapability("record:read", `/dashboard/sales/invoices/${id}`);
  const [data, actor, t] = await Promise.all([getInvoice(id), getActor(), getTranslations("invoices")]);
  if (!data) notFound();

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/sales/invoices"
        className="inline-flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        {t("back")}
      </Link>
      <InvoiceView
        data={JSON.parse(JSON.stringify(data))}
        canWrite={can(actor, "invoice:write")}
        canIssue={can(actor, "invoice:issue")}
      />
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";

import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getQuoteById } from "@/actions/quotes";
import { auth } from "@/auth";
import { QuoteDetail } from "@/components/crm/quote-detail";
import { RecordVisit } from "@/components/crm/record-visit";
import { documentLanguage } from "@/lib/document-language";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ send?: string }>;
}

export default async function QuoteDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { send } = await searchParams;
  const session = await auth();
  // ⚠️ The workspace role, not the platform one. `session.user.role` is Flux's
  // own staff scale and reads "user" for every customer who ever signs in, so
  // gating on it hid the approve button from the very people entitled to press
  // it — while the server action, which asks for `quote:approve`, would have
  // allowed them. See the two role scales in CLAUDE.md.
  const tenantRole = session?.user?.tenantRole ?? null;
  const t = await getTranslations("quotes.detail");

  let quote: Awaited<ReturnType<typeof getQuoteById>>;
  try {
    quote = await getQuoteById(id);
  } catch {
    notFound();
  }

  // The follow-up drafts go to the customer, so they are written in the customer's
  // language even when the dashboard is in the other one.
  const customerLanguage = documentLanguage(quote.company);
  const tCustomer = await getTranslations({ locale: customerLanguage, namespace: "quoteFollowUp" });
  const customerDrafts = Object.fromEntries(
    ["notOpened", "noAnswer", "expiring", "expired"].map((k) => [
      k,
      { subject: String(tCustomer.raw(`${k}Subject`)), body: String(tCustomer.raw(`${k}Body`)) },
    ]),
  );

  return (
    <div className="flex flex-col gap-6">
      <RecordVisit type="quote" id={quote.id} label={quote.quoteNumber} sub={quote.company?.name ?? null} />
      <div>
        <Link
          href="/dashboard/sales/quotes"
          className="inline-flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          {t("backToQuotes")}
        </Link>
      </div>
      <QuoteDetail
        quote={quote}
        autoOpenSend={send === "1"}
        tenantRole={tenantRole}
        customerLanguage={customerLanguage}
        customerDrafts={customerDrafts}
      />
    </div>
  );
}

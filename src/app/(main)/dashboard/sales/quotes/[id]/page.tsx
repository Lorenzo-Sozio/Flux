import { notFound } from "next/navigation";

import { getTranslations } from "next-intl/server";

import { getQuoteById } from "@/actions/quotes";
import { auth } from "@/auth";
import { QuoteDetail } from "@/components/crm/quote-detail";
import { RecordBackLink, RecordPage } from "@/components/crm/record/record-page";
import { RecordVisit } from "@/components/crm/record-visit";
import { documentLanguage } from "@/lib/document-language";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ send?: string }>;
}

/**
 * One quote, on the plan every record page follows (see the deal page): the hero
 * and its figures, then the lines as the work and the customer, the tracking and
 * the history beside them. The layout is in `QuoteDetail`, a client component
 * because its actions open dialogs; this page loads the data and the drafts.
 */
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
    <RecordPage>
      <RecordVisit type="quote" id={quote.id} label={quote.quoteNumber} sub={quote.company?.name ?? null} />
      <RecordBackLink href="/dashboard/sales/quotes">{t("backToQuotes")}</RecordBackLink>
      <QuoteDetail
        quote={quote}
        autoOpenSend={send === "1"}
        tenantRole={tenantRole}
        customerLanguage={customerLanguage}
        customerDrafts={customerDrafts}
      />
    </RecordPage>
  );
}

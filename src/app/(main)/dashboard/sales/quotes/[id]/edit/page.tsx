import { notFound, redirect } from "next/navigation";

import { getQuoteById, getQuoteFormData } from "@/actions/quotes";

import { QuoteEditForm } from "./_components/quote-edit-form";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Editing a quote.
 *
 * Only while it is a draft: a quote that has been sent is a promise somebody has
 * already read, and changing it under them is not an edit.
 *
 * The heading lives in the form rather than here, because the form's is the bar
 * that does not scroll away — it carries the quote number, the running total and
 * the two ways out, and a second title above it would only repeat itself.
 */
export default async function QuoteEditPage({ params }: Props) {
  const { id } = await params;

  let quote: Awaited<ReturnType<typeof getQuoteById>>;
  try {
    quote = await getQuoteById(id);
  } catch {
    notFound();
  }

  if (quote.status !== "draft") {
    redirect(`/dashboard/sales/quotes/${id}`);
  }

  const formData = await getQuoteFormData();

  return <QuoteEditForm quote={quote} formData={formData} />;
}

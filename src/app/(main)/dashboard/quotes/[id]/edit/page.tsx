import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, FileEdit } from "lucide-react";
import { getQuoteById, getQuoteFormData } from "@/actions/quotes";
import { QuoteEditForm } from "./_components/quote-edit-form";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function QuoteEditPage({ params }: Props) {
  const { id } = await params;

  let quote: Awaited<ReturnType<typeof getQuoteById>>;
  try {
    quote = await getQuoteById(id);
  } catch {
    notFound();
  }

  if (quote.status !== "draft") {
    redirect(`/dashboard/quotes/${id}`);
  }

  const formData = await getQuoteFormData();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Link
          href={`/dashboard/quotes/${id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Quote
        </Link>
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <FileEdit className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Edit Quote</h1>
            <p className="text-sm text-muted-foreground font-mono">{quote.quoteNumber}</p>
          </div>
        </div>
      </div>

      <QuoteEditForm quote={quote} formData={formData} />
    </div>
  );
}

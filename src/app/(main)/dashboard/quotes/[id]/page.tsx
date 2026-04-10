import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getQuoteById } from "@/actions/quotes";
import { QuoteDetail } from "@/components/crm/quote-detail";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ send?: string }>;
}

export default async function QuoteDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { send } = await searchParams;

  let quote: Awaited<ReturnType<typeof getQuoteById>>;
  try {
    quote = await getQuoteById(id);
  } catch {
    notFound();
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <Link
        href="/dashboard/quotes"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
        Back to Quotes
      </Link>
      <QuoteDetail quote={quote} autoOpenSend={send === "1"} />
    </div>
  );
}

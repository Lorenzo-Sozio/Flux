import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/auth";
import { getQuoteById } from "@/actions/quotes";
import { QuoteDetail } from "@/components/crm/quote-detail";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ send?: string }>;
}

export default async function QuoteDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { send } = await searchParams;
  const session = await auth();
  const userRole = session?.user?.role ?? "user";

  let quote: Awaited<ReturnType<typeof getQuoteById>>;
  try {
    quote = await getQuoteById(id);
  } catch {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Link
          href="/dashboard/quotes"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Quotes
        </Link>
      </div>
      <QuoteDetail quote={quote} autoOpenSend={send === "1"} userRole={userRole} />
    </div>
  );
}

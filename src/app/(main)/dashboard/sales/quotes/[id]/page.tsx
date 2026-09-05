import Link from "next/link";
import { notFound } from "next/navigation";

import { ChevronLeft } from "lucide-react";

import { getQuoteById } from "@/actions/quotes";
import { auth } from "@/auth";
import { QuoteDetail } from "@/components/crm/quote-detail";

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

  let quote: Awaited<ReturnType<typeof getQuoteById>>;
  try {
    quote = await getQuoteById(id);
  } catch {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/dashboard/sales/quotes"
          className="inline-flex items-center gap-1 text-muted-foreground text-sm transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Quotes
        </Link>
      </div>
      <QuoteDetail quote={quote} autoOpenSend={send === "1"} tenantRole={tenantRole} />
    </div>
  );
}

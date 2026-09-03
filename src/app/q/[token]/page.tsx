import { notFound } from "next/navigation";

import { appUrl } from "@/lib/app-url";

import { PublicQuoteView } from "./_components/public-quote-view";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function PublicQuotePage({ params }: Props) {
  const { token } = await params;

  const res = await fetch(appUrl(`/api/quotes/public?token=${token}`), {
    cache: "no-store",
  });

  if (!res.ok) notFound();
  const { quote } = await res.json();

  return <PublicQuoteView quote={quote} token={token} />;
}

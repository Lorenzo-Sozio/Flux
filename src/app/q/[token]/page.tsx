import { notFound } from "next/navigation";

import { PublicQuoteView } from "./_components/public-quote-view";

interface Props {
  params: Promise<{ token: string }>;
}

export default async function PublicQuotePage({ params }: Props) {
  const { token } = await params;

  const res = await fetch(`${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/api/quotes/public?token=${token}`, {
    cache: "no-store",
  });

  if (!res.ok) notFound();
  const { quote } = await res.json();

  return <PublicQuoteView quote={quote} token={token} />;
}

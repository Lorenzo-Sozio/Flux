import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { clientIp } from "@/lib/client-ip";
import { readPublicQuote } from "@/lib/quote-public";

import { PublicQuoteView } from "./_components/public-quote-view";

interface Props {
  params: Promise<{ token: string }>;
}

/**
 * ⚠️ Read directly, never by fetching this app's own API from the server: that request
 * carried the server's address, so every customer of every workspace shared one rate-limit
 * bucket — sixty junk requests a minute closed every quote link — and "viewed from" was the
 * server. The customer's address is the one the platform saw (src/lib/client-ip.ts).
 */
export default async function PublicQuotePage({ params }: Props) {
  const { token } = await params;
  const read = await readPublicQuote(token, clientIp(await headers()));
  if (read.status !== 200) notFound();
  return <PublicQuoteView quote={JSON.parse(JSON.stringify(read.quote))} token={token} />;
}

import { notFound } from "next/navigation";

import type { Metadata } from "next";

import { fill, formatDocumentDate } from "@/lib/document-language";
import { isCsatRating } from "@/lib/ticket-public";
import { loadTicketStatus } from "@/lib/ticket-public-page";
import { customerStatus, TICKET_TEXT } from "@/lib/ticket-public-text";
import { cn } from "@/lib/utils";

import { RatingBox } from "./rating-box";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ workspace: string; token: string }>;
  searchParams: Promise<{ rate?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { workspace, token } = await params;
  const found = await loadTicketStatus(workspace, token).catch(() => null);
  return {
    title: found ? fill(TICKET_TEXT[found.page.lang].pageTitle, { number: found.page.number }) : "—",
    // A private conversation: never in an index, never in a referrer.
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

/**
 * A customer's request, as they may see it: status, the public conversation, and — once it is
 * resolved — how it went. In the customer's language, the one their emails were written in.
 */
export default async function TicketStatusPage({ params, searchParams }: Props) {
  const { workspace, token } = await params;
  const { rate } = await searchParams;
  const found = await loadTicketStatus(workspace, token).catch(() => null);
  if (!found) notFound();
  const { page, workspaceName } = found;
  const t = TICKET_TEXT[page.lang];

  return (
    <main className="mx-auto min-h-dvh max-w-2xl space-y-6 p-4 sm:py-10">
      <header className="space-y-1">
        <p className="text-muted-foreground text-sm">{workspaceName}</p>
        <h1 className="font-semibold text-xl">{fill(t.pageTitle, { number: page.number })}</h1>
        <p className="text-base">{page.subject}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-muted-foreground text-sm">
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 font-medium text-xs",
              page.status === "resolved" || page.status === "closed"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                : "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
            )}
          >
            {customerStatus(page.status, page.lang)}
          </span>
          <span>{fill(t.opened, { date: formatDocumentDate(page.createdAt, page.lang) })}</span>
          <span>{fill(t.updated, { date: formatDocumentDate(page.updatedAt, page.lang) })}</span>
        </div>
      </header>

      {page.canRate && (
        <RatingBox
          workspace={workspace}
          token={token}
          text={t}
          initial={page.rating}
          initialComment={page.comment}
          preselected={isCsatRating(rate) ? rate : null}
        />
      )}

      <section className="space-y-3">
        <h2 className="font-medium text-muted-foreground text-sm">{t.conversation}</h2>
        {page.messages.map((m, i) => (
          <article
            // biome-ignore lint/suspicious/noArrayIndexKey: messages are read-only and never reordered
            key={i}
            className={cn("rounded-lg border p-4", m.fromCustomer ? "bg-muted/40" : "bg-card")}
          >
            <p className="mb-2 text-muted-foreground text-xs">
              {m.fromCustomer ? (i === 0 ? t.yourRequest : t.you) : workspaceName} ·{" "}
              {formatDocumentDate(m.at, page.lang)}
            </p>
            {/* Sanitised in src/lib/ticket-public.ts: email HTML, shown to whoever holds the link. */}
            <div
              className="prose prose-sm dark:prose-invert max-w-none break-words"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised by sanitizeEmailHtml
              dangerouslySetInnerHTML={{ __html: m.html }}
            />
          </article>
        ))}
        <p className="text-muted-foreground text-sm">{t.replyHint}</p>
      </section>
    </main>
  );
}

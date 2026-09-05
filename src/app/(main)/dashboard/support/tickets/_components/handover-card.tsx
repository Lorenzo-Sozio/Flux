"use client";

import { AlertCircle, ArrowLeftRight, CheckCircle2, MessageSquare, StickyNote } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { excerpt, type HandoverMessage, handover } from "@/lib/ticket-handover";

/**
 * Where this ticket stands, for whoever is picking it up.
 *
 * The audit's fourth ask under S-05 is a summary of the thread for whoever takes
 * over, and it was the one part recorded as needing a language model. It does
 * not. What the person needs, in the order they need it, is whose move it is,
 * how long that has been true, what was originally asked, and what has already
 * been tried — all four exact, all four already in the messages.
 *
 * So this quotes rather than summarises. A paragraph from a model would bury
 * "they are waiting on us" in the middle of a sentence, and this is read in
 * about fifteen seconds by somebody deciding what to do next.
 */
export function HandoverCard({ messages }: { messages: HandoverMessage[] }) {
  const t = useTranslations("handover");
  const h = handover(messages);

  // A ticket nobody has written on yet has no thread to hand over.
  if (h.publicMessages === 0 && h.internalNotes === 0) return null;

  const waitingOnUs = h.waiting === "us";
  const tone = waitingOnUs
    ? "border-amber-500/40 bg-amber-500/5"
    : h.waiting === "customer"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : "";

  return (
    <Card className={tone}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 font-semibold text-muted-foreground text-sm uppercase tracking-wide">
          <ArrowLeftRight className="h-4 w-4" />
          {t("title")}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        {/* Whose move it is — the one fact that decides whether to open this. */}
        <div className="flex items-start gap-2">
          {waitingOnUs ? (
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          )}
          <div>
            <p className="font-medium">{t(`waiting.${h.waiting}`)}</p>
            {h.waitingHours !== null && (
              <p className="text-muted-foreground text-xs">
                {h.waitingHours < 24
                  ? t("forHours", { hours: h.waitingHours })
                  : t("forDays", { days: Math.floor(h.waitingHours / 24) })}
              </p>
            )}
          </div>
        </div>

        {/* ⚠️ Said plainly rather than left to be inferred from a message count. */}
        {h.neverAnswered && h.publicMessages > 0 && (
          <p className="rounded-md border border-red-500/40 bg-red-500/5 px-2.5 py-1.5 text-red-700 text-xs dark:text-red-400">
            {t("neverAnswered")}
          </p>
        )}

        {h.opening && (
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">{t("asked")}</p>
            <p className="mt-0.5 text-muted-foreground italic">“{excerpt(h.opening.text)}”</p>
          </div>
        )}

        {h.lastWord && h.publicMessages > 1 && (
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">
              {h.lastWord.fromUs ? t("lastFromUs") : t("lastFromThem")}
            </p>
            <p className="mt-0.5 text-muted-foreground italic">“{excerpt(h.lastWord.text)}”</p>
          </div>
        )}

        {h.lastNote && (
          <div>
            <p className="flex items-center gap-1.5 text-muted-foreground text-xs uppercase tracking-wide">
              <StickyNote className="h-3 w-3" />
              {t("alreadyTried")}
            </p>
            <p className="mt-0.5 text-muted-foreground italic">“{excerpt(h.lastNote.text)}”</p>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5 pt-1">
          <Badge variant="outline" className="gap-1 font-normal">
            <MessageSquare className="h-3 w-3" />
            {t("exchanges", { count: h.publicMessages })}
          </Badge>
          {h.internalNotes > 0 && (
            <Badge variant="outline" className="gap-1 font-normal">
              <StickyNote className="h-3 w-3" />
              {t("notes", { count: h.internalNotes })}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

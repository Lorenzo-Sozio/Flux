"use client";

import { useEffect, useState, useTransition } from "react";

import { ThumbsDown, ThumbsUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CsatRating } from "@/lib/ticket-public";
import type { TicketText } from "@/lib/ticket-public-text";
import { cn } from "@/lib/utils";

async function send(body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch("/api/tickets/public", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  return Boolean(res?.ok);
}

/**
 * "How did we do?" — two buttons, and a comment if they want to say more.
 *
 * ⚠️⚠️ The email's buttons land here with `?rate=`, and that answer is only **highlighted**:
 * it is recorded when a person presses it. Mail scanners fetch every link in a message, and
 * some open it in a real browser that runs this page's script — a page that sent the answer
 * on load had them vote, both buttons, the last one winning, each flip a notification. The
 * parameter is dropped from the address, so a reload does not suggest it again.
 */
export function RatingBox({
  workspace,
  token,
  text,
  initial,
  initialComment,
  preselected,
}: {
  workspace: string;
  token: string;
  text: TicketText;
  initial: CsatRating | null;
  initialComment: string | null;
  preselected: CsatRating | null;
}) {
  const [rating, setRating] = useState<CsatRating | null>(initial);
  const [comment, setComment] = useState(initialComment ?? "");
  const [savedComment, setSavedComment] = useState(Boolean(initialComment));
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  // The email's answer, waiting for a person to press it.
  const [suggested, setSuggested] = useState<CsatRating | null>(
    preselected && preselected !== initial ? preselected : null,
  );

  const rate = (next: CsatRating) =>
    startTransition(async () => {
      setError(false);
      if (await send({ workspace, token, rating: next })) {
        setRating(next);
        setSuggested(null);
      } else setError(true);
    });

  useEffect(() => {
    if (!preselected) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("rate");
    window.history.replaceState(null, "", url.toString());
  }, [preselected]);

  const saveComment = () =>
    startTransition(async () => {
      setError(false);
      if (!rating) return;
      if (await send({ workspace, token, rating, comment })) setSavedComment(true);
      else setError(true);
    });

  const choice = (value: CsatRating, label: string, Icon: typeof ThumbsUp) => (
    <Button
      type="button"
      variant="outline"
      aria-pressed={rating === value || suggested === value}
      disabled={pending}
      onClick={() => rate(value)}
      className={cn(
        "h-11 flex-1 gap-2 sm:flex-none",
        (rating === value || suggested === value) &&
          (value === "good"
            ? "border-emerald-600 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
            : "border-red-600 bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300"),
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </Button>
  );

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="font-medium">{rating ? text.thanks : text.rateHeading}</h2>
        <p className="text-muted-foreground text-sm">
          {rating ? text.changeHint : suggested ? text.confirmHint : text.rateHelp}
        </p>
      </div>
      <div className="flex gap-2">
        {choice("good", text.rateGood, ThumbsUp)}
        {choice("bad", text.rateBad, ThumbsDown)}
      </div>
      {rating && (
        <div className="space-y-2">
          <Label htmlFor="csat-comment">{text.commentLabel}</Label>
          <Textarea
            id="csat-comment"
            rows={3}
            maxLength={2000}
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              setSavedComment(false);
            }}
          />
          <Button
            type="button"
            className="h-11 sm:h-9"
            disabled={pending || savedComment || !comment.trim()}
            onClick={saveComment}
          >
            {savedComment ? text.thanks : text.send}
          </Button>
        </div>
      )}
      {error && <p className="text-destructive text-sm">{text.failed}</p>}
    </section>
  );
}

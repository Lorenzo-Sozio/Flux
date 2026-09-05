"use client";

import { useMemo, useState } from "react";

import { format } from "date-fns";
import { Check, ClipboardCopy, FileText } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { buildMinutes, type MinutesActivity, type MinutesTask, windowAround } from "@/lib/meeting-minutes";

/**
 * The minutes for one meeting, assembled from what was recorded (rilievo S-06).
 *
 * ⚠️ Nothing here is composed. Every sentence was typed by a person into an
 * activity; the dialog decides what belongs to this meeting and in what order,
 * and takes "what was agreed" from the tasks raised afterwards rather than from
 * anybody's account of the conversation. This product holds no transcript, so
 * there is nothing to summarise — a model asked for minutes would invent the
 * decisions, and the result would read exactly like a record.
 */
export function MinutesDialog({
  activities,
  tasks,
  dealName,
}: {
  activities: MinutesActivity[];
  tasks: MinutesTask[];
  dealName: string;
}) {
  const t = useTranslations("minutes");
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Only a meeting or a call can have minutes. A note is not a meeting.
  const meetings = useMemo(
    () =>
      activities
        .filter((a) => (a.type === "meeting" || a.type === "call") && a.date)
        .sort((a, b) => (b.date as Date).getTime() - (a.date as Date).getTime()),
    [activities],
  );

  const chosen = meetings.find((m) => m.id === selected) ?? meetings[0] ?? null;
  const minutes = chosen?.date ? buildMinutes(activities, tasks, windowAround(chosen.date)) : null;

  // Nothing to offer: the button would open on an apology.
  if (meetings.length === 0) return null;

  const asText = () => {
    if (!minutes) return "";
    const lines = [
      `${t("title")} — ${dealName}`,
      `${format(minutes.from, "d MMM yyyy")}`,
      "",
      minutes.attendees.length ? `${t("attendees")}: ${minutes.attendees.join(", ")}` : "",
      "",
    ];
    for (const s of minutes.sessions) {
      lines.push(
        `— ${t(s.kind)} · ${format(s.at, "d MMM HH:mm")}${s.durationMinutes ? ` · ${s.durationMinutes}'` : ""}`,
      );
      if (s.notes) lines.push(s.notes);
      lines.push("");
    }
    if (minutes.context.length) {
      lines.push(`${t("alsoLogged")}:`);
      for (const c of minutes.context) lines.push(`- ${format(c.at, "d MMM HH:mm")} — ${c.text}`);
      lines.push("");
    }
    if (minutes.agreed.length) {
      lines.push(`${t("agreed")}:`);
      for (const a of minutes.agreed) {
        lines.push(
          `- ${a.title}${a.ownerName ? ` (${a.ownerName})` : ""}${a.dueDate ? ` — ${format(a.dueDate, "d MMM")}` : ""}`,
        );
      }
    }
    return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access is refused over plain HTTP and in some browsers. The
      // minutes are on screen and selectable, so nothing is lost.
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <FileText className="h-4 w-4" />
          {t("action")}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        {meetings.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {meetings.map((m) => (
              <Button
                key={m.id}
                type="button"
                size="sm"
                variant={chosen?.id === m.id ? "secondary" : "ghost"}
                onClick={() => setSelected(m.id)}
              >
                {format(m.date as Date, "d MMM")}
              </Button>
            ))}
          </div>
        )}

        {minutes && (
          <div className="space-y-4 text-sm">
            {minutes.attendees.length > 0 && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide">{t("attendees")}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {minutes.attendees.map((a) => (
                    <Badge key={a} variant="outline" className="font-normal">
                      {a}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {minutes.sessions.map((s) => (
                <div key={s.id} className="rounded-md border p-3">
                  <p className="font-medium">
                    {t(s.kind)} · {format(s.at, "d MMM yyyy HH:mm")}
                    {s.durationMinutes ? ` · ${t("forMinutes", { minutes: s.durationMinutes })}` : ""}
                  </p>
                  {s.notes ? (
                    <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{s.notes}</p>
                  ) : (
                    <p className="mt-1 text-muted-foreground text-xs italic">{t("nothingWritten")}</p>
                  )}
                </div>
              ))}
            </div>

            {minutes.context.length > 0 && (
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide">{t("alsoLogged")}</p>
                <ul className="mt-1 space-y-1 text-muted-foreground">
                  {minutes.context.map((c) => (
                    <li key={c.id}>
                      <span className="text-xs">{format(c.at, "d MMM HH:mm")}</span> — {c.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide">{t("agreed")}</p>
              {minutes.agreed.length > 0 ? (
                <ul className="mt-1 space-y-1">
                  {minutes.agreed.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-baseline gap-2">
                      <span>{a.title}</span>
                      {a.ownerName && <span className="text-muted-foreground text-xs">{a.ownerName}</span>}
                      {a.dueDate && <span className="text-muted-foreground text-xs">{format(a.dueDate, "d MMM")}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                // ⚠️ Said out loud. Minutes that simply omit the section read as
                // if the meeting had no outcome, rather than as a prompt to raise
                // the tasks somebody agreed to.
                <p className="mt-1 text-muted-foreground text-xs italic">{t("nothingAgreed")}</p>
              )}
            </div>

            <div className="flex justify-end">
              <Button type="button" variant="secondary" size="sm" className="gap-2" onClick={copy}>
                {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <ClipboardCopy className="h-4 w-4" />}
                {t("copy")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

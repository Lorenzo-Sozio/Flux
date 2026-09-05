"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { ArrowRight, Lightbulb, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { triageTicket } from "@/actions/support";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Triage = Awaited<ReturnType<typeof triageTicket>>;

/**
 * What this ticket resembles, and what that suggests.
 *
 * ⚠️ Everything here is a proposal and nothing is applied. Each one names the
 * tickets it came from, which is the point: an agent can see why it was suggested
 * and disagree, which is not something an answer from a model offers.
 *
 * It renders nothing at all when there is nothing to say. A panel that says "no
 * suggestions" on every new desk is furniture.
 */
export function TriageCard({
  subject,
  description,
  excludeId,
}: {
  subject: string;
  description?: string | null;
  excludeId?: string;
}) {
  const t = useTranslations("triage");
  const [data, setData] = useState<Triage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    triageTicket({ subject, description, excludeId })
      .then((r) => {
        if (live) setData(r);
      })
      .catch(() => {
        // A suggestion that cannot be made is not worth interrupting anyone for:
        // the ticket is what matters and it is already on screen.
        if (live) setData(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [subject, description, excludeId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("looking")}
        </CardContent>
      </Card>
    );
  }

  const suggestions = [
    { label: t("priority"), s: data?.priority },
    { label: t("type"), s: data?.type },
    { label: t("component"), s: data?.component },
  ].filter((x) => x.s);

  const hasSomething = (data?.similar.length ?? 0) > 0 || suggestions.length > 0 || (data?.macros.length ?? 0) > 0;
  if (!hasSomething) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("subtitle")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {suggestions.length > 0 && (
          <div className="space-y-1.5">
            {suggestions.map(({ label, s }) => (
              <div key={label} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span className="text-muted-foreground">{label}</span>
                <Badge variant="outline" className="font-medium">
                  {s?.value}
                </Badge>
                <span className="text-muted-foreground text-xs">
                  {t("basedOn", { tickets: s?.from.join(", ") ?? "" })}
                </span>
              </div>
            ))}
          </div>
        )}

        {(data?.similar.length ?? 0) > 0 && (
          <div>
            <p className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {t("alreadySolved")}
            </p>
            <ul className="divide-y">
              {data?.similar.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/dashboard/support/tickets/${s.id}`}
                    className="group -mx-2 flex items-start gap-2 rounded-md px-2 py-2 transition-colors hover:bg-muted/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-muted-foreground text-xs">{s.ticketNumber}</span>
                        <span className="text-muted-foreground text-xs">
                          {t("match", { pct: Math.round(s.score * 100) })}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-sm">{s.subject}</span>
                      {s.shared.length > 0 && (
                        <span className="mt-0.5 block truncate text-muted-foreground text-xs">
                          {s.shared.join(" · ")}
                        </span>
                      )}
                    </span>
                    <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(data?.macros.length ?? 0) > 0 && (
          <div>
            <p className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">{t("macros")}</p>
            <div className="flex flex-wrap gap-1.5">
              {data?.macros.map((m) => (
                <Badge key={m.id} variant="secondary" className="font-normal">
                  {m.name}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

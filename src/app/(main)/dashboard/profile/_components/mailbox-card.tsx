"use client";

import { useEffect, useState, useTransition } from "react";

import { useSearchParams } from "next/navigation";

import { Mail, Unplug } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { disconnectMailboxAction, type MailboxState } from "@/actions/mailbox";
import { StatusBadge } from "@/components/crm/record/record-page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const OUTCOMES = ["connected", "denied", "error", "unavailable"] as const;

/**
 * The person's own mailbox and calendar at Google or Microsoft (V3.2). Connecting is a plain
 * link to /api/mail/connect/<provider>: the trip to the consent screen and back is a
 * navigation, not a fetch. When no provider may be connected here, the card says why.
 */
export function MailboxCard({ initial }: { initial: MailboxState }) {
  const t = useTranslations("profile.mailbox");
  const format = useFormatter();
  const search = useSearchParams();
  const [state, setState] = useState(initial);
  const [pending, startTransition] = useTransition();

  // Back from the consent screen: say how it went, once.
  const outcome = search.get("mail");
  useEffect(() => {
    if (!outcome || !(OUTCOMES as readonly string[]).includes(outcome)) return;
    if (outcome === "connected") toast.success(t("outcome.connected"));
    else toast.error(t(`outcome.${outcome as Exclude<(typeof OUTCOMES)[number], "connected">}`));
  }, [outcome, t]);

  const disconnect = () =>
    startTransition(async () => {
      const next = await disconnectMailboxAction().catch(() => null);
      if (!next) {
        toast.error(t("outcome.error"));
        return;
      }
      setState(next);
      toast.success(t("disconnected"));
    });

  const when = (d: Date | null) => (d ? format.relativeTime(new Date(d)) : t("never"));
  const conn = state.connection;
  const connectable = state.providers.filter((p) => p.canConnect);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="size-5 shrink-0 text-primary" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>{t("does.send")}</li>
          <li>{t("does.file")}</li>
          <li>{t("does.busy")}</li>
          <li>{t("does.mirror")}</li>
        </ul>

        {conn ? (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{conn.email}</p>
                <p className="text-muted-foreground text-xs">{t(`provider.${conn.provider}`)}</p>
              </div>
              {conn.status === "active" ? (
                <StatusBadge tone="success">{t("status.active")}</StatusBadge>
              ) : (
                <StatusBadge tone="danger">{t("status.revoked")}</StatusBadge>
              )}
            </div>
            <dl className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t("mailSynced")}</dt>
                <dd>{when(conn.mailSyncedAt)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("busySynced")}</dt>
                <dd>{when(conn.busySyncedAt)}</dd>
              </div>
            </dl>
            {conn.lastError && (
              <p className="break-words rounded-md bg-destructive/10 p-2 text-destructive text-xs">
                {t("lastError", { when: when(conn.lastErrorAt) })} {conn.lastError}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {conn.status !== "active" && state.providers.find((p) => p.id === conn.provider)?.canConnect && (
                <Button asChild size="sm">
                  <a href={`/api/mail/connect/${conn.provider}`}>{t("reconnect")}</a>
                </Button>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" disabled={pending}>
                    <Unplug className="size-4" aria-hidden />
                    {t("disconnect")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("disconnectTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>{t("disconnectBody")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                    <AlertDialogAction onClick={disconnect}>{t("disconnect")}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ) : state.readOnly ? (
          <p className="text-muted-foreground">{t("readOnly")}</p>
        ) : connectable.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {connectable.map((p) => (
              <Button key={p.id} asChild variant="outline">
                <a href={`/api/mail/connect/${p.id}`}>{t(`connect.${p.id}`)}</a>
              </Button>
            ))}
            {connectable.some((p) => p.state === "testing") && (
              <p className="w-full text-muted-foreground text-xs">{t("testingNote")}</p>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground">
            {state.providers.some((p) => p.state === "testing") ? t("beingVerified") : t("notAvailable")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

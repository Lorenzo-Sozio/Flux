"use client";

import { useState, useTransition } from "react";

import { Copy, Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { type ArchiveAddressState, rotateArchiveAddressAction } from "@/actions/profile";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The person's Bcc archive address (src/lib/mail-archive.ts): what to put in Bcc, what it
 * does, and a way to retire it. When it cannot work here, the card says why instead.
 */
export function ArchiveAddressCard({ initial }: { initial: ArchiveAddressState }) {
  const t = useTranslations("profile.archive");
  const tp = useTranslations("profile");
  const tc = useTranslations("common");
  const [state, setState] = useState(initial);
  const [pending, startTransition] = useTransition();

  const copy = (address: string) =>
    navigator.clipboard
      .writeText(address)
      .then(() => toast.success(t("copied")))
      .catch(() => toast.error(tp("failed")));

  const rotate = () =>
    startTransition(async () => {
      const next = await rotateArchiveAddressAction().catch(() => null);
      if (!next) {
        toast.error(tp("failed"));
        return;
      }
      setState(next);
      toast.success(t("rotated"));
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Inbox className="size-5 shrink-0 text-primary" aria-hidden />
          {t("title")}
        </CardTitle>
        <CardDescription>{t("help")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.status === "ready" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="archive-address">{t("label")}</Label>
              <div className="flex gap-2">
                <Input
                  id="archive-address"
                  value={state.address}
                  readOnly
                  className="min-w-0 flex-1 font-mono text-xs sm:text-sm"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button type="button" variant="outline" onClick={() => copy(state.address)}>
                  <Copy className="size-4" aria-hidden />
                  <span className="max-sm:sr-only">{t("copy")}</span>
                </Button>
              </div>
            </div>
            <p className="text-muted-foreground text-sm">{t("howMatched")}</p>
            <p className="text-muted-foreground text-sm">{t("secret")}</p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" disabled={pending}>
                  {t("rotate")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("rotateTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>{t("rotateBody")}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={rotate}>{t("rotate")}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{t(state.reason)}</p>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { Download, ShieldAlert, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { erasePersonAction, exportPersonAction, previewErasureAction } from "@/actions/privacy";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The person's rights, from their record (§13.8): hand them their data, or erase them.
 *
 * ⚠️ Both start from the contact point — the email, else the phone — because that is what
 * the person gives when they ask, and what the engines find them by: every record of theirs,
 * not only this one. The confirmation says how many, and asks for the contact point to be
 * typed, because an erasure cannot be taken back.
 */
export function PrivacyCard({ contactPoint, listPath }: { contactPoint: string | null; listPath: string }) {
  const t = useTranslations("privacy");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [found, setFound] = useState<{ lead: number; contact: number } | null>(null);
  const [typed, setTyped] = useState("");

  if (!contactPoint) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("title")}</CardTitle>
          <CardDescription>{t("noContactPoint")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const download = () =>
    startTransition(async () => {
      const result = await exportPersonAction(contactPoint).catch(() => null);
      if (!result?.ok) {
        toast.error(t(result ? "invalid" : "failed"));
        return;
      }
      const url = URL.createObjectURL(new Blob([result.json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("exported"));
    });

  const askToErase = () =>
    startTransition(async () => {
      const result = await previewErasureAction(contactPoint).catch(() => null);
      if (!result?.ok) {
        toast.error(t(result ? "invalid" : "failed"));
        return;
      }
      setFound(result.found);
      setTyped("");
      setOpen(true);
    });

  const erase = () =>
    startTransition(async () => {
      const result = await erasePersonAction(contactPoint).catch(() => null);
      if (!result?.ok) {
        toast.error(t(result ? "invalid" : "failed"));
        return;
      }
      setOpen(false);
      toast.success(t("erased"));
      router.push(listPath);
    });

  const confirmed = typed.trim().toLowerCase() === contactPoint.trim().toLowerCase();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
        <CardDescription>{t("help", { contactPoint })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 sm:flex-row">
        <Button variant="outline" size="sm" onClick={download} disabled={pending}>
          <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {t("export")}
        </Button>
        <Button variant="outline" size="sm" className="text-destructive" onClick={askToErase} disabled={pending}>
          <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
          {t("erase")}
        </Button>
      </CardContent>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-destructive" aria-hidden />
              {t("eraseTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("eraseBody", { leads: found?.lead ?? 0, contacts: found?.contact ?? 0, contactPoint })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-muted-foreground text-sm">{t("eraseKeeps")}</p>
          <div className="space-y-1.5">
            <Label htmlFor="erase-confirm">{t("typeToConfirm", { contactPoint })}</Label>
            <Input
              id="erase-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="md:text-sm"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{tc("cancel")}</AlertDialogCancel>
            <Button variant="destructive" onClick={erase} disabled={!confirmed || pending}>
              {t("eraseConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

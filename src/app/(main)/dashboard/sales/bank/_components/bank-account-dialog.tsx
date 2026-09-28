"use client";

import { useEffect, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { createBankAccountAction, updateBankAccountAction } from "@/actions/bank";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { Account } from "./bank-view";

/** A new account, or a correction to one: name and IBAN. The currency is chosen once. */
export function BankAccountDialog({
  open,
  onOpenChange,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: Account | null;
}) {
  const t = useTranslations("bank");
  const router = useRouter();
  const [name, setName] = useState("");
  const [iban, setIban] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setName(account?.name ?? "");
    setIban(account?.iban ?? "");
    setCurrency(account?.currency ?? "EUR");
  }, [open, account]);

  function save() {
    start(async () => {
      if (account) {
        const r = await updateBankAccountAction(account.id, { name, iban }).catch(() => null);
        if (!r?.ok) {
          toast.error(r && !r.ok ? r.error : t("failed"));
          return;
        }
        onOpenChange(false);
        router.refresh();
        return;
      }
      const r = await createBankAccountAction({ name, iban, currency }).catch(() => null);
      if (!r?.ok) {
        toast.error(r && !r.ok ? r.error : t("failed"));
        return;
      }
      onOpenChange(false);
      router.push(`/dashboard/sales/bank?account=${encodeURIComponent(r.id)}`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{account ? t("editAccount") : t("addAccount")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="bank-account-name">{t("accountName")}</Label>
            <Input
              id="bank-account-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("accountNamePlaceholder")}
              maxLength={80}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank-account-iban">{t("iban")}</Label>
            <Input
              id="bank-account-iban"
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              autoCapitalize="characters"
              spellCheck={false}
              className="font-mono"
            />
          </div>
          {!account && (
            <div className="space-y-1.5">
              <Label htmlFor="bank-account-currency">{t("currency")}</Label>
              <Input
                id="bank-account-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                className="w-24 font-mono uppercase"
              />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending || !name.trim()} className="gap-1.5">
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              {t("save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

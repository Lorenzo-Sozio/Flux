"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { Loader2, PencilIcon, TruckIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { setOrderShipping } from "@/actions/orders";
import { Field, FieldList } from "@/components/crm/record/record-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Where the order is on its way: the day the customer was told to expect it, who carries it and
 * the code to follow it (migration 0071). The order emails fill "[data di consegna]", "[corriere]"
 * and "[codice di tracciamento]" from these, so they are written here once instead of in every email.
 */
export function ShippingCard({
  orderId,
  expectedDeliveryDate,
  carrier,
  trackingCode,
  canWrite,
}: {
  orderId: string;
  /** YYYY-MM-DD, a calendar day: shown as written, never through a time zone. */
  expectedDeliveryDate: string | null;
  carrier: string | null;
  trackingCode: string | null;
  canWrite: boolean;
}) {
  const t = useTranslations("orders.shipping");
  const format = useFormatter();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [day, setDay] = useState(expectedDeliveryDate ?? "");
  const [by, setBy] = useState(carrier ?? "");
  const [code, setCode] = useState(trackingCode ?? "");
  const [pending, startTransition] = useTransition();

  const open = () => {
    setDay(expectedDeliveryDate ?? "");
    setBy(carrier ?? "");
    setCode(trackingCode ?? "");
    setEditing(true);
  };

  const save = () =>
    startTransition(async () => {
      const r = await setOrderShipping(orderId, { expectedDeliveryDate: day, carrier: by, trackingCode: code }).catch(
        () => null,
      );
      if (!r?.success) {
        toast.error(r && !r.success ? r.error : t("saveFailed"));
        return;
      }
      toast.success(t("saved"));
      setEditing(false);
      router.refresh();
    });

  // Noon UTC, so no time zone moves the day it names.
  const shownDay = expectedDeliveryDate
    ? format.dateTime(new Date(`${expectedDeliveryDate}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })
    : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <TruckIcon className="size-4 text-muted-foreground" aria-hidden />
          {t("title")}
        </CardTitle>
        {canWrite && !editing && (
          <Button type="button" variant="ghost" size="sm" onClick={open}>
            <PencilIcon className="size-3.5" aria-hidden />
            {t("edit")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="shipping-day" className="text-xs">
                {t("expectedDelivery")}
              </Label>
              <Input id="shipping-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="shipping-carrier" className="text-xs">
                {t("carrier")}
              </Label>
              <Input
                id="shipping-carrier"
                value={by}
                maxLength={120}
                placeholder={t("carrierPlaceholder")}
                onChange={(e) => setBy(e.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="shipping-code" className="text-xs">
                {t("trackingCode")}
              </Label>
              <Input
                id="shipping-code"
                value={code}
                maxLength={120}
                placeholder={t("trackingPlaceholder")}
                onChange={(e) => setCode(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={pending}>
                {t("cancel")}
              </Button>
              <Button type="button" size="sm" onClick={save} disabled={pending}>
                {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
                {t("save")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <FieldList>
              <Field label={t("expectedDelivery")}>
                {shownDay && <span className="tabular-nums">{shownDay}</span>}
              </Field>
              <Field label={t("carrier")}>{carrier}</Field>
              <Field label={t("trackingCode")}>
                {trackingCode && <span className="break-all font-mono text-xs">{trackingCode}</span>}
              </Field>
            </FieldList>
            {!expectedDeliveryDate && !carrier && !trackingCode && (
              <p className="text-muted-foreground text-sm">{t("empty")}</p>
            )}
          </>
        )}
        <p className="text-muted-foreground text-xs">{t("hint")}</p>
      </CardContent>
    </Card>
  );
}

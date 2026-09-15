"use client";

import { useMemo, useState } from "react";

import { CheckCircle2, CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { type IssuerProfileRow, saveIssuerProfile } from "@/actions/invoicing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { issuerGaps, TAX_REGIMES } from "@/lib/fiscal-ids";
import { cleanIssuer } from "@/lib/invoice-issuer";

const FIELDS = [
  "legalName",
  "vatNumber",
  "fiscalCode",
  "taxRegime",
  "street",
  "zipCode",
  "city",
  "province",
  "country",
  "reaOffice",
  "reaNumber",
  "shareCapital",
  "soleShareholder",
  "liquidationStatus",
  "email",
  "phone",
  "iban",
  "bankName",
] as const;
type Field = (typeof FIELDS)[number];
type Values = Record<Field, string>;

const NONE = "none";

export function IssuerForm({ initial }: { initial: IssuerProfileRow | null }) {
  const t = useTranslations("invoicing");
  const [values, setValues] = useState<Values>(
    () =>
      Object.fromEntries(
        FIELDS.map((f) => [
          f,
          initial?.[f] != null ? String(initial[f]) : f === "taxRegime" ? "RF01" : f === "country" ? "IT" : "",
        ]),
      ) as Values,
  );
  const [recharge, setRecharge] = useState(Boolean(initial?.rechargeStampDuty));
  const [saving, setSaving] = useState(false);
  // Computed on what will be stored, so "it 00905811006" does not show as invalid.
  const gaps = useMemo(() => issuerGaps(cleanIssuer(values)), [values]);
  const invalid = new Set(gaps.map((g) => g.field));

  const set = (field: Field, value: string) => setValues((v) => ({ ...v, [field]: value }));

  const save = async () => {
    setSaving(true);
    try {
      await saveIssuerProfile({ ...values, rechargeStampDuty: recharge });
      toast.success(t("saved"));
    } catch {
      toast.error(t("failed"));
    } finally {
      setSaving(false);
    }
  };

  const input = (field: Field, props: React.ComponentProps<typeof Input> = {}) => (
    <div>
      <Label htmlFor={`issuer-${field}`}>{t(`fields.${field}`)}</Label>
      <Input
        id={`issuer-${field}`}
        className="mt-1.5"
        value={values[field]}
        aria-invalid={invalid.has(field)}
        onChange={(e) => set(field, e.target.value)}
        {...props}
      />
    </div>
  );

  const choice = (field: "soleShareholder" | "liquidationStatus", options: readonly string[], ns: string) => (
    <div>
      <Label>{t(`fields.${field}`)}</Label>
      <Select value={values[field] || NONE} onValueChange={(v) => set(field, v === NONE ? "" : v)}>
        <SelectTrigger className="mt-1.5" aria-invalid={invalid.has(field)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[NONE, ...options].map((o) => (
            <SelectItem key={o} value={o}>
              {t(`${ns}.${o}` as "soleShareholderOptions.none")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card
        className={
          gaps.length ? "border-amber-300 dark:border-amber-800" : "border-emerald-300 dark:border-emerald-800"
        }
      >
        <CardContent className="flex gap-3 p-4 text-sm">
          {gaps.length === 0 ? (
            <>
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              <p>{t("ready")}</p>
            </>
          ) : (
            <>
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="min-w-0">
                <p className="font-medium">{t("notReady")}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {gaps.map((g) => (
                    <li key={`${g.field}-${g.problem}`}>
                      {t(`fields.${g.field}` as "fields.vatNumber")} — {t(`problems.${g.problem}`)}
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("sections.identity")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">{input("legalName")}</div>
          {input("vatNumber", { placeholder: "01234567890" })}
          {input("fiscalCode")}
          <div className="sm:col-span-2">
            <Label>{t("fields.taxRegime")}</Label>
            <Select value={values.taxRegime} onValueChange={(v) => set("taxRegime", v)}>
              <SelectTrigger className="mt-1.5" aria-invalid={invalid.has("taxRegime")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(TAX_REGIMES).map(([code, label]) => (
                  <SelectItem key={code} value={code}>
                    {code} — {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("sections.address")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">{input("street")}</div>
          {input("zipCode", { inputMode: "numeric" })}
          {input("city")}
          {input("province", { placeholder: "MI", maxLength: 2 })}
          {input("country")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("sections.rea")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {input("reaOffice", { placeholder: "MI", maxLength: 2 })}
          {input("reaNumber")}
          {input("shareCapital", { inputMode: "decimal" })}
          {choice("soleShareholder", ["SU", "SM"], "soleShareholderOptions")}
          {choice("liquidationStatus", ["LN", "LS"], "liquidationOptions")}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {t("sections.payment")} · {t("sections.contacts")}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">{input("iban")}</div>
          {input("bankName")}
          {input("email", { type: "email" })}
          {input("phone", { type: "tel" })}
          <div className="flex items-start gap-2 sm:col-span-2">
            <Checkbox
              id="issuer-recharge"
              className="mt-0.5"
              checked={recharge}
              onCheckedChange={(v) => setRecharge(v === true)}
            />
            <div className="min-w-0">
              <Label htmlFor="issuer-recharge" className="cursor-pointer">
                {t("fields.rechargeStampDuty")}
              </Label>
              <p className="text-muted-foreground text-xs">{t("rechargeStampDutyHint")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";

import { Copy, ExternalLink, Headphones, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { saveWebFormAction, type WebFormSettings } from "@/actions/web-forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const NOBODY = "__nobody";

/**
 * The workspace's two public forms: open or closed, who they go to, and how to put them on
 * a website — a link, a frame, or a form of your own posting to the endpoint.
 */
export function FormsClient({
  forms,
  workspace,
  endpoint,
  owners,
  turnstile,
}: {
  forms: WebFormSettings[];
  workspace: string | null;
  endpoint: string | null;
  owners: { id: string; name: string }[];
  turnstile: boolean;
}) {
  const t = useTranslations("settings.forms");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      {forms.map((form) => (
        <FormCard key={form.kind} form={form} workspace={workspace} endpoint={endpoint} owners={owners} />
      ))}
      <p className="text-muted-foreground text-xs">{turnstile ? t("turnstileOn") : t("turnstileOff")}</p>
    </div>
  );
}

function FormCard({
  form,
  workspace,
  endpoint,
  owners,
}: {
  form: WebFormSettings;
  workspace: string | null;
  endpoint: string | null;
  owners: { id: string; name: string }[];
}) {
  const t = useTranslations("settings.forms");
  const [enabled, setEnabled] = useState(form.enabled);
  const [ownerId, setOwnerId] = useState(form.ownerId);
  const [pending, startTransition] = useTransition();
  const Icon = form.kind === "lead" ? UserPlus : Headphones;

  const save = (next: { enabled: boolean; ownerId: string | null }) =>
    startTransition(async () => {
      const result = await saveWebFormAction(form.kind, next).catch(() => null);
      if (!result?.ok) {
        toast.error(t("failed"));
        return;
      }
      setEnabled(next.enabled);
      setOwnerId(next.ownerId);
      toast.success(t("saved"));
    });

  const copy = (value: string) =>
    navigator.clipboard
      .writeText(value)
      .then(() => toast.success(t("copied")))
      .catch(() => toast.error(t("failed")));

  const embed = form.url
    ? `<iframe src="${form.url}" title="${t(`${form.kind}.name`)}" style="width:100%;min-height:680px;border:0"></iframe>`
    : null;
  const fields =
    form.kind === "lead" ? "name, email, phone, company, message, consent" : "name, email, subject, description";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="size-5 shrink-0 text-primary" aria-hidden />
          {t(`${form.kind}.name`)}
        </CardTitle>
        <CardDescription>{t(`${form.kind}.help`)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch
            id={`form-${form.kind}`}
            checked={enabled}
            disabled={pending}
            onCheckedChange={(v) => save({ enabled: v, ownerId })}
          />
          <Label htmlFor={`form-${form.kind}`}>{enabled ? t("open") : t("closed")}</Label>
        </div>

        <div className="space-y-1.5 sm:max-w-sm">
          <Label>{t(`${form.kind}.owner`)}</Label>
          <Select
            value={ownerId ?? NOBODY}
            onValueChange={(v) => save({ enabled, ownerId: v === NOBODY ? null : v })}
            disabled={pending}
          >
            <SelectTrigger aria-label={t(`${form.kind}.owner`)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NOBODY}>{t("nobody")}</SelectItem>
              {owners.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {form.url && (
          <div className="space-y-1.5">
            <Label>{t("link")}</Label>
            <div className="flex gap-2">
              <Input value={form.url} readOnly className="min-w-0 flex-1 font-mono text-xs sm:text-sm" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => copy(form.url ?? "")}
                aria-label={t("copy")}
              >
                <Copy className="size-4" />
              </Button>
              <Button asChild variant="outline" size="icon" aria-label={t("preview")}>
                <a href={form.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" />
                </a>
              </Button>
            </div>
          </div>
        )}
        {embed && (
          <div className="space-y-1.5">
            <Label>{t("embed")}</Label>
            <Textarea value={embed} readOnly rows={2} className="font-mono text-xs" />
          </div>
        )}
        {endpoint && workspace && (
          <p className="text-muted-foreground text-xs">
            {t("ownForm", { endpoint, workspace, token: form.token, fields })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

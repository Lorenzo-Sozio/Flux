"use client";

import { useRef, useState, useTransition } from "react";

import { CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WebFormPage } from "@/lib/web-forms-public";

const ERRORS = ["invalid", "captcha", "notFound", "tooMany"];

/**
 * "Contact us" or "Open a support request". Sent as JSON with whatever Turnstile put in the
 * form, so the same endpoint serves this page and a customer's own form.
 */
export function WebFormClient({ workspace, token, page }: { workspace: string; token: string; page: WebFormPage }) {
  const t = useTranslations("webForm");
  const formRef = useRef<HTMLFormElement>(null);
  const [consent, setConsent] = useState(false);
  const [done, setDone] = useState<{ ticketNumber?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const kind = page.kind;

  const submit = () =>
    startTransition(async () => {
      setError(null);
      if (!formRef.current) return;
      const fields = Object.fromEntries(new FormData(formRef.current).entries());
      const res = await fetch("/api/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, workspace, token, consent }),
      }).catch(() => null);
      const body = res ? await res.json().catch(() => null) : null;
      if (body?.ok) {
        setDone({ ticketNumber: body.ticketNumber });
        return;
      }
      const reason = typeof body?.reason === "string" && ERRORS.includes(body.reason) ? body.reason : "failed";
      setError(t(`errors.${reason}` as never));
    });

  if (done) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-lg items-center p-4">
        <Card className="w-full">
          <CardHeader className="items-center text-center">
            <CheckCircle2 className="size-10 text-emerald-600" aria-hidden />
            <CardTitle>{t(`${kind}.doneTitle`)}</CardTitle>
            <CardDescription>
              {kind === "ticket" && done.ticketNumber
                ? t("ticket.doneBody", { number: done.ticketNumber })
                : t("lead.doneBody", { name: page.workspaceName })}
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-4 sm:py-10">
      <Card>
        <CardHeader>
          <CardTitle>{t(`${kind}.title`, { name: page.workspaceName })}</CardTitle>
          <CardDescription>{t(`${kind}.help`)}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            ref={formRef}
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="wf-name">{t("name")}</Label>
                <Input id="wf-name" name="name" required maxLength={120} autoComplete="name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wf-email">{t("email")}</Label>
                <Input id="wf-email" name="email" type="email" required autoComplete="email" />
              </div>
              {kind === "lead" && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="wf-phone">{t("phone")}</Label>
                    <Input id="wf-phone" name="phone" type="tel" autoComplete="tel" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="wf-company">{t("company")}</Label>
                    <Input id="wf-company" name="company" maxLength={200} autoComplete="organization" />
                  </div>
                </>
              )}
            </div>
            {kind === "ticket" && (
              <div className="space-y-1.5">
                <Label htmlFor="wf-subject">{t("subject")}</Label>
                <Input id="wf-subject" name="subject" required maxLength={200} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="wf-message">{kind === "ticket" ? t("description") : t("message")}</Label>
              <Textarea
                id="wf-message"
                name={kind === "ticket" ? "description" : "message"}
                rows={5}
                required={kind === "ticket"}
                maxLength={kind === "ticket" ? 10_000 : 5000}
              />
            </div>
            {kind === "lead" && (
              <div className="flex items-start gap-2">
                <Checkbox id="wf-consent" checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
                <Label htmlFor="wf-consent" className="font-normal text-muted-foreground text-xs leading-snug">
                  {t("consent", { name: page.workspaceName })}
                </Label>
              </div>
            )}
            {/* No person sees or fills this; a script does. */}
            <div aria-hidden className="absolute left-[-9999px] h-0 w-0 overflow-hidden">
              <label htmlFor="wf-website">Website</label>
              <input id="wf-website" name="website" tabIndex={-1} autoComplete="off" />
            </div>
            {page.siteKey && <div className="cf-turnstile" data-sitekey={page.siteKey} />}
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              {t("send")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

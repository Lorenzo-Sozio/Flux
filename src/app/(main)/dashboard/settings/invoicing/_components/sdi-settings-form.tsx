"use client";

import { useState, useTransition } from "react";

import { Loader2, PlugZap, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { type getSdiSettings, saveSdiSettings, testSdiConnection } from "@/actions/sdi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Settings = Awaited<ReturnType<typeof getSdiSettings>>;

/**
 * How the workspace reaches SDI (src/lib/sdi/): by hand — the XML downloaded and uploaded
 * elsewhere — or through an intermediary with the workspace's own account there.
 *
 * ⚠️ The password is never sent back to the page: an empty field keeps the one held.
 * ⚠️ Automatic sending is off by default: it writes to the tax authority.
 */
export function SdiSettingsForm({ initial }: { initial: Settings }) {
  const t = useTranslations("invoicing.sdi");
  const [channel, setChannel] = useState<string>(initial.channel);
  const [environment, setEnvironment] = useState<string>(initial.environment);
  const [username, setUsername] = useState(initial.username);
  const [accountId, setAccountId] = useState(initial.accountId);
  const [password, setPassword] = useState("");
  const [autoSend, setAutoSend] = useState(initial.autoSend);
  const [pending, startTransition] = useTransition();
  const viaProvider = channel !== "manual";
  const chosen = initial.channels.find((c) => c.id === channel);
  const label = chosen?.label ?? "";
  // Each intermediary signs in its own way: the fields are its own (src/lib/sdi/registry.ts).
  const asks = (field: string) => Boolean(chosen?.credentials.includes(field));
  const usesToken = asks("token");

  function save(thenTest: boolean) {
    startTransition(async () => {
      const r = await saveSdiSettings({ channel, environment, username, password, accountId, autoSend }).catch(
        () => null,
      );
      if (!r?.ok) {
        toast.error(r && !r.ok ? r.error : t("failed"));
        return;
      }
      setPassword("");
      if (!thenTest) {
        toast.success(t("saved"));
        return;
      }
      const checked = await testSdiConnection().catch(() => null);
      if (checked?.ok) toast.success(t("connected", { provider: label }));
      else toast.error(checked && !checked.ok ? checked.error : t("failed"));
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Send className="size-4 text-muted-foreground" aria-hidden />
          {t("title")}
        </CardTitle>
        <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="sdi-channel">{t("channel")}</Label>
            <Select value={channel} onValueChange={setChannel}>
              <SelectTrigger id="sdi-channel" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {initial.channels.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.id === "manual" ? t("manual") : c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {viaProvider && chosen?.hasDemo && (
            <div className="space-y-1.5">
              <Label htmlFor="sdi-environment">{t("environment")}</Label>
              <Select value={environment} onValueChange={setEnvironment}>
                <SelectTrigger id="sdi-environment" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="demo">{t("demo")}</SelectItem>
                  <SelectItem value="production">{t("production")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {!viaProvider ? (
          <p className="text-muted-foreground text-sm">{t("manualHint")}</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {asks("username") && (
                <div className="space-y-1.5">
                  <Label htmlFor="sdi-username">{t("username")}</Label>
                  <Input
                    id="sdi-username"
                    autoComplete="off"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
              )}
              {asks("accountId") && (
                <div className="space-y-1.5">
                  <Label htmlFor="sdi-account">{t("accountId")}</Label>
                  <Input
                    id="sdi-account"
                    autoComplete="off"
                    inputMode="numeric"
                    value={accountId}
                    placeholder={t("accountIdPlaceholder")}
                    onChange={(e) => setAccountId(e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="sdi-password">{usesToken ? t("token") : t("password")}</Label>
                <Input
                  id="sdi-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  placeholder={initial.hasPassword ? t("passwordKept") : ""}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <Checkbox
                id="sdi-auto-send"
                checked={autoSend}
                onCheckedChange={(v) => setAutoSend(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="sdi-auto-send" className="block font-normal">
                {t("autoSend")}
                <span className="block text-muted-foreground text-xs">{t("autoSendHint")}</span>
              </Label>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground text-xs">
              {channel === "fattureincloud" ? (
                <>
                  <li>{t("hintFicToken")}</li>
                  <li>{t("hintFicTotals")}</li>
                  <li>{t("hintFicNumbers")}</li>
                </>
              ) : (
                <>
                  <li>{t("hintTransmitter", { provider: label })}</li>
                  <li>{t("hintAccount", { provider: label })}</li>
                  {environment === "demo" && <li>{t("hintDemo")}</li>}
                </>
              )}
            </ul>
          </>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {viaProvider && (
            <Button type="button" variant="outline" className="gap-1.5" onClick={() => save(true)} disabled={pending}>
              {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <PlugZap className="size-3.5" />}
              {t("saveAndTest")}
            </Button>
          )}
          <Button type="button" onClick={() => save(false)} disabled={pending}>
            {t("save")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

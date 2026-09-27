"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { CheckCircle, Copy, KeyRound, Plus, TriangleAlert } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { type ApiKeyRow, createApiKeyAction, revokeApiKeyAction, revokeTenantApiKey } from "@/actions/tenant-api-key";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMessageText } from "@/hooks/use-message-text";
import { API_ENTITIES, READABLE, scopeName, WRITABLE } from "@/lib/api-scopes";

/**
 * This workspace's machine-to-machine keys, each with what it may do (src/lib/api-scopes.ts).
 *
 * ⚠️⚠️ **Shown once.** Only the SHA-256 is stored: a credential that can be read back later
 * is a credential that leaks through whatever can read it back — a support ticket, a backup,
 * a screen share. A key is told apart from the others by its name and its last four
 * characters.
 *
 * ⚠️ The tenant id is on this page **on purpose**: an integration using the platform key
 * needs it, and hunting for it in a browser address bar is where a configuration stops.
 */
export function ApiKeyClient({ keys, legacy, tenantId }: { keys: ApiKeyRow[]; legacy: boolean; tenantId: string }) {
  const t = useTranslations("settings.apiKey");
  const say = useMessageText();
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [made, setMade] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Set<string>>(new Set());

  const copy = async (text: string, which: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  };

  const toggle = (scope: string, on: boolean) =>
    setScopes((prev) => {
      const next = new Set(prev);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });

  const create = () =>
    startTransition(async () => {
      try {
        const result = await createApiKeyAction({ name, scopes: [...scopes] });
        if (!result.ok) {
          toast.error(say(result));
          return;
        }
        setMade(result.key);
        setCreating(false);
        setName("");
        setScopes(new Set());
        router.refresh();
      } catch {
        toast.error(t("createFailed"));
      }
    });

  const revoke = (id: string | null) =>
    startTransition(async () => {
      if (!window.confirm(t("revokeConfirm"))) return;
      try {
        if (id) await revokeApiKeyAction(id);
        else await revokeTenantApiKey();
        toast.success(t("revoked"));
        router.refresh();
      } catch {
        toast.error(t("revokeFailed"));
      }
    });

  const date = (d: Date | null) =>
    d ? format.dateTime(new Date(d), { day: "numeric", month: "short", year: "numeric" }) : "—";

  return (
    // No padding of its own: the dashboard layout owns page padding.
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {made && (
            <Alert>
              <AlertDescription className="flex flex-col gap-2">
                <span className="font-medium">{t("copyNow")}</span>
                <code className="block overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{made}</code>
                <Button size="sm" variant="outline" className="w-fit max-md:h-11" onClick={() => copy(made, "key")}>
                  {copied === "key" ? <CheckCircle className="size-3.5" /> : <Copy className="size-3.5" />}
                  {t("copyKey")}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {keys.length === 0 && !creating && <p className="text-muted-foreground text-sm">{t("none")}</p>}

          <ul className="flex flex-col gap-2">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="font-medium text-sm">
                    {k.name} <span className="font-mono text-muted-foreground text-xs">…{k.hint}</span>
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {k.scopes.map((s) => (
                      <Badge key={s} variant="secondary" className="font-mono text-[11px]">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {t("madeBy", { who: k.createdBy ?? "—", date: date(k.createdAt) })} ·{" "}
                    {k.lastUsedAt ? t("lastUsed", { date: date(k.lastUsedAt) }) : t("neverUsed")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-fit shrink-0 max-md:h-11"
                  disabled={pending}
                  onClick={() => revoke(k.id)}
                >
                  {t("revoke")}
                </Button>
              </li>
            ))}
          </ul>

          {creating ? (
            <div className="flex flex-col gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor="key-name">{t("name")}</Label>
                <Input
                  id="key-name"
                  className="mt-1.5"
                  value={name}
                  maxLength={80}
                  placeholder={t("namePlaceholder")}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <fieldset>
                <legend className="font-medium text-sm">{t("scopesTitle")}</legend>
                <p className="mb-2 text-muted-foreground text-xs">{t("scopesHelp")}</p>
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-1 text-sm">
                  <span />
                  <span className="text-muted-foreground text-xs">{t("read")}</span>
                  <span className="text-muted-foreground text-xs">{t("write")}</span>
                  {API_ENTITIES.map((entity) => (
                    <div key={entity} className="contents">
                      <span className="min-w-0 py-1.5">{t(`entities.${entity}`)}</span>
                      {(["read", "write"] as const).map((access) => {
                        const scope = scopeName({ entity, access });
                        const possible = (access === "write" ? WRITABLE : READABLE).includes(entity);
                        return (
                          <div key={access} className="flex min-h-11 items-center justify-center md:min-h-8">
                            {possible ? (
                              <Checkbox
                                checked={scopes.has(scope)}
                                onCheckedChange={(v) => toggle(scope, v === true)}
                                aria-label={`${t(`entities.${entity}`)} — ${t(access)}`}
                              />
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="max-md:h-11"
                  disabled={pending || !name.trim() || scopes.size === 0}
                  onClick={create}
                >
                  {t("create")}
                </Button>
                <Button size="sm" variant="ghost" className="max-md:h-11" onClick={() => setCreating(false)}>
                  {t("cancel")}
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" className="w-fit gap-1.5 max-md:h-11" onClick={() => setCreating(true)}>
              <Plus className="size-3.5" />
              {t("new")}
            </Button>
          )}
        </CardContent>
      </Card>

      {legacy && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("legacyTitle")}</CardTitle>
            <CardDescription>{t("legacyDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="flex items-start gap-2 text-muted-foreground text-xs">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {t("legacyHelp")}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-fit max-md:h-11"
              disabled={pending}
              onClick={() => revoke(null)}
            >
              {t("revoke")}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("tenantIdTitle")}</CardTitle>
          <CardDescription>{t("tenantIdDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <code className="block overflow-x-auto rounded bg-muted p-2 font-mono text-xs">{tenantId}</code>
          <Button size="sm" variant="outline" className="w-fit max-md:h-11" onClick={() => copy(tenantId, "id")}>
            {copied === "id" ? <CheckCircle className="size-3.5" /> : <Copy className="size-3.5" />}
            {t("copyTenantId")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

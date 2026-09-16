"use client";

import { useState } from "react";

import { CheckCircle, Copy, KeyRound, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { mintTenantApiKey, revokeTenantApiKey } from "@/actions/tenant-api-key";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The machine-to-machine key of this tenant, and where it goes.
 *
 * ⚠️⚠️ **Shown once.** Only the SHA-256 is stored: a credential that can be read back later
 * is a credential that leaks through whatever can read it back — a support ticket, a backup,
 * a screen share. Minting again replaces the previous one, which is also how you rotate.
 *
 * ⚠️ The tenant id is on this page **on purpose**: an integration that has to reach this
 * tenant needs it in the URL, and hunting for it in a browser address bar is where a
 * configuration stops.
 */
export function ApiKeyClient({ exists, tenantId }: { exists: boolean; tenantId: string }) {
  const t = useTranslations("settings.apiKey");
  const [chiave, setChiave] = useState<string | null>(null);
  const [ceLa, setCeLa] = useState(exists);
  const [inCorso, setInCorso] = useState(false);
  const [copiato, setCopiato] = useState<string | null>(null);

  const copia = async (testo: string, quale: string) => {
    await navigator.clipboard.writeText(testo);
    setCopiato(quale);
    setTimeout(() => setCopiato(null), 2000);
  };

  const conia = async () => {
    setInCorso(true);
    try {
      const { key } = await mintTenantApiKey();
      setChiave(key);
      setCeLa(true);
    } catch {
      toast.error(t("createFailed"));
    } finally {
      setInCorso(false);
    }
  };

  const revoca = async () => {
    setInCorso(true);
    try {
      await revokeTenantApiKey();
      setChiave(null);
      setCeLa(false);
      toast.success(t("revoked"));
    } catch {
      toast.error(t("revokeFailed"));
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {chiave && (
            <Alert>
              <AlertDescription className="flex flex-col gap-2">
                <span className="font-medium">{t("copyNow")}</span>
                <code className="bg-muted block overflow-x-auto rounded p-2 font-mono text-xs">{chiave}</code>
                <Button size="sm" variant="outline" className="w-fit" onClick={() => copia(chiave, "chiave")}>
                  {copiato === "chiave" ? <CheckCircle className="size-3.5" /> : <Copy className="size-3.5" />}
                  {t("copyKey")}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {ceLa && !chiave && (
            <Alert>
              <AlertDescription>{t("exists")}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={inCorso} onClick={conia}>
              {ceLa ? t("createNew") : t("create")}
            </Button>
            {ceLa && (
              <Button size="sm" variant="outline" disabled={inCorso} onClick={revoca}>
                {t("revoke")}
              </Button>
            )}
          </div>

          {ceLa && (
            <p className="text-muted-foreground flex items-start gap-2 text-xs">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {t("rotateWarning")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("tenantIdTitle")}</CardTitle>
          <CardDescription>{t("tenantIdDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <code className="bg-muted block overflow-x-auto rounded p-2 font-mono text-xs">{tenantId}</code>
          <Button size="sm" variant="outline" className="w-fit" onClick={() => copia(tenantId, "id")}>
            {copiato === "id" ? <CheckCircle className="size-3.5" /> : <Copy className="size-3.5" />}
            {t("copyTenantId")}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

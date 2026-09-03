"use client";

import { useState } from "react";

import { CheckCircle, Copy, KeyRound, TriangleAlert } from "lucide-react";
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
      toast.error("Non sono riuscito a creare la chiave.");
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
      toast.success("Chiave revocata: le chiamate con quella chiave smettono subito.");
    } catch {
      toast.error("Non sono riuscito a revocare la chiave.");
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
            Chiave API
          </CardTitle>
          <CardDescription>
            Serve a un sistema esterno per scrivere qui dentro: contatti, note, campi raccolti. Non è la password di
            nessuno, ed è legata a questa attività.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {chiave && (
            <Alert>
              <AlertDescription className="flex flex-col gap-2">
                <span className="font-medium">Copiala adesso: non te la mostrerò più.</span>
                <code className="bg-muted block overflow-x-auto rounded p-2 font-mono text-xs">{chiave}</code>
                <Button size="sm" variant="outline" className="w-fit" onClick={() => copia(chiave, "chiave")}>
                  {copiato === "chiave" ? <CheckCircle className="size-3.5" /> : <Copy className="size-3.5" />}
                  Copia la chiave
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {ceLa && !chiave && (
            <Alert>
              <AlertDescription>
                Una chiave esiste già. Non si può rileggere: se l&apos;hai persa, creane una nuova — quella vecchia
                smette di funzionare nello stesso momento.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={inCorso} onClick={conia}>
              {ceLa ? "Crea una chiave nuova" : "Crea la chiave"}
            </Button>
            {ceLa && (
              <Button size="sm" variant="outline" disabled={inCorso} onClick={revoca}>
                Revoca
              </Button>
            )}
          </div>

          {ceLa && (
            <p className="text-muted-foreground flex items-start gap-2 text-xs">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              Creandone una nuova, quella di prima smette di funzionare subito: l&apos; integrazione che la usa va
              aggiornata nello stesso momento.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Identificativo di questa attività</CardTitle>
          <CardDescription>
            Serve a comporre l&apos;indirizzo a cui un sistema esterno manda i propri eventi.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <code className="bg-muted block overflow-x-auto rounded p-2 font-mono text-xs">{tenantId}</code>
          <Button size="sm" variant="outline" className="w-fit" onClick={() => copia(tenantId, "id")}>
            {copiato === "id" ? <CheckCircle className="size-3.5" /> : <Copy className="size-3.5" />}
            Copia l&apos;identificativo
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

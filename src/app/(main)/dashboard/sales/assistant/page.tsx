import { contributoDellAssistente } from "@/actions/assistant-contribution";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * What the assistant brought in — read from this CRM, not from the assistant.
 *
 * ## Why the page exists here as well
 *
 * The assistant has its own report of what it did. This one answers the same business
 * question from the other side: *what landed in my CRM because of it*. Two views, two
 * databases, and a workspace that has never bought the assistant still opens this page —
 * it just shows nothing brought in, which is the truth.
 *
 * ⚠️ **The two numbers are not meant to match**, and a note on the page says so. Over
 * there the unit is a process the assistant ran; here it is a record that landed. Making
 * them agree would mean one product asking the other what to believe, and the boundary
 * between them exists precisely so that neither has to.
 *
 * ## ⚠️⚠️ Orders with no answer are shown, not hidden
 *
 * Rows written before the `source` column existed carry no provenance. Folding them into
 * "a person" would invent a number for a period this database cannot know; dropping them
 * would make the total lower than the truth **and plausible**, which nobody would catch.
 * They get their own line and their own sentence.
 */
export default async function AssistantContributionPage() {
  const oggi = new Date();
  const primo = new Date(oggi.getFullYear(), oggi.getMonth(), 1);
  // ⚠️ The last instant of the last day, not its midnight: `order_date` carries a time,
  // and an inclusive range that stops at 00:00 loses everything placed on the last day.
  const ultimo = new Date(oggi.getFullYear(), oggi.getMonth() + 1, 0, 23, 59, 59, 999);
  const mese = primo.toLocaleDateString("it-IT", { month: "long", year: "numeric" });

  const c = await contributoDellAssistente(primo, ultimo);
  const totaleOrdini = c.ordiniDallAssistente + c.ordiniDaPersona;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">Il contributo dell&apos;assistente</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Che cosa è arrivato in questo CRM tramite l&apos;assistente, in {mese}.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ordini presi dall&apos;assistente</CardDescription>
            <CardTitle className="text-4xl tabular-nums">{c.ordiniDallAssistente}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {totaleOrdini > 0
                ? `Su ${totaleOrdini} ordini con una provenienza registrata in ${mese}.`
                : `Nessun ordine con una provenienza registrata in ${mese}.`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Valore di quegli ordini</CardDescription>
            <CardTitle className="text-4xl tabular-nums">
              {new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(
                Number(c.incassoDallAssistente),
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Totale degli ordini presi dall&apos;assistente in {mese}, IVA inclusa.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Anagrafiche create dall&apos;assistente</CardDescription>
            <CardTitle className="text-4xl tabular-nums">{c.contattiDallAssistente}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Su {c.contattiTotali} contatti in rubrica. ⚠️ È un totale di sempre, non del mese: una scheda si crea una
              volta sola.
            </p>
          </CardContent>
        </Card>
      </div>

      {c.ordiniNonRegistrati > 0 && (
        <Alert>
          <AlertDescription>
            <strong>{c.ordiniNonRegistrati}</strong>{" "}
            {c.ordiniNonRegistrati === 1 ? "ordine di questo mese non dice" : "ordini di questo mese non dicono"} da
            dove {c.ordiniNonRegistrati === 1 ? "arriva" : "arrivano"}: sono stati scritti prima che il CRM registrasse
            la provenienza. {c.ordiniNonRegistrati === 1 ? "Non è contato" : "Non sono contati"} né fra quelli
            dell&apos;assistente né fra quelli inseriti da una persona, perché attribuirli sarebbe inventare.
          </AlertDescription>
        </Alert>
      )}

      {/*
        ⚠️⚠️ Accanto ai numeri e non in fondo: senza questa riga chi guarda le due
        schermate le confronta e conclude che una delle due sbaglia.
      */}
      <Alert>
        <AlertDescription>
          <strong>Questi numeri sono di questo CRM.</strong> Contano ciò che è arrivato qui: ordini e schede.
          L&apos;assistente ha un proprio rapporto, che conta un&apos;altra cosa — i processi che ha portato a termine,
          comprese le conversazioni che non hanno prodotto un ordine. I due totali non coincidono, ed è giusto così:
          nessuno dei due prodotti chiede all&apos;altro che cosa credere.
        </AlertDescription>
      </Alert>
    </div>
  );
}

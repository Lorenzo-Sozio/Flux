import { attivitaDellAssistente, type VoceAttivita } from "@/actions/assistant-activity";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requirePageCapability } from "@/lib/page-guard";

/**
 * What the assistant has been doing in this CRM.
 *
 * ## Why it is not under `/dashboard/reports`
 *
 * That section is behind the reporting module. «What is the thing writing into my CRM
 * doing» is a question a workspace has the moment it connects one, whether or not it has
 * bought a reports package — and a page that answers it only for some customers is a page
 * that leaves the rest guessing about an automation they are already paying for.
 *
 * ## Why it is not a count of orders
 *
 * The first version of this screen counted orders and the contacts created beside them —
 * one of the seven things the assistant does here, and the *side effect* rather than the
 * work. A month spent qualifying leads and answering people showed as nothing done.
 *
 * ## ⚠️ Everything on the page is read from this database
 *
 * No request goes to the assistant. A workspace that has never connected one opens this
 * and sees nothing, which is the truth; one that disconnects keeps its history.
 */
export default async function AssistantActivityPage() {
  await requirePageCapability("report:read", "/dashboard/assistant");

  const oggi = new Date();
  const primo = new Date(oggi.getFullYear(), oggi.getMonth(), 1);
  // ⚠️ The last instant of the last day, not its midnight: a range that stops at 00:00
  // loses a whole day and still looks plausible.
  const ultimo = new Date(oggi.getFullYear(), oggi.getMonth() + 1, 0, 23, 59, 59, 999);
  const mese = primo.toLocaleDateString("it-IT", { month: "long", year: "numeric" });

  const { voci, richiesteDaPersona } = await attivitaDellAssistente(primo, ultimo);
  const totaleRighe = voci.reduce((s, v) => s + v.righe, 0);
  const totaleRichieste = voci.reduce((s, v) => s + v.richieste, 0);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">Che cosa ha fatto l&apos;assistente</h1>
        <p className="mt-1 text-muted-foreground text-sm">
          Le scritture arrivate in questo CRM da un&apos;integrazione, in {mese}.
        </p>
      </div>

      {voci.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nessuna scrittura in {mese}</CardTitle>
            <CardDescription>
              Nessuna integrazione ha scritto in questo spazio di lavoro nel mese in corso. Se un assistente è
              collegato, comparirà qui alla prima cosa che fa: non c&apos;è niente da accendere.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Cose scritte</CardDescription>
                <CardTitle className="text-4xl tabular-nums">{totaleRighe}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  Righe create o aggiornate in {mese}, di {voci.length}{" "}
                  {voci.length === 1 ? "tipo diverso" : "tipi diversi"}.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Richieste</CardDescription>
                <CardTitle className="text-4xl tabular-nums">{totaleRichieste}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  ⚠️ Una richiesta può scrivere molte righe: un&apos;importazione è una richiesta sola.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Ultima volta</CardDescription>
                <CardTitle className="text-2xl">{quando(voci)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">
                  Un silenzio lungo è la cosa che conviene notare per prima: qui ha una data.
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Che cosa ha scritto</CardTitle>
              <CardDescription>
                L&apos;elenco è quello che le rotte hanno registrato, non una lista tenuta a mano: il giorno in cui
                l&apos;assistente impara a fare una cosa nuova, quella cosa compare qui da sola.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-right">Righe</TableHead>
                      <TableHead className="text-right">Richieste</TableHead>
                      <TableHead className="text-right">Ultima</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {voci.map((v) => (
                      <TableRow key={v.entity}>
                        <TableCell className="font-medium">{etichetta(v.entity)}</TableCell>
                        <TableCell className="text-right tabular-nums">{v.righe}</TableCell>
                        <TableCell className="text-right tabular-nums">{v.richieste}</TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {v.ultima ? v.ultima.toLocaleDateString("it-IT") : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {richiesteDaPersona > 0 && (
        <Alert>
          <AlertDescription>
            <strong>{richiesteDaPersona}</strong>{" "}
            {richiesteDaPersona === 1 ? "richiesta è arrivata" : "richieste sono arrivate"} dalle stesse rotte ma con
            l&apos;accesso di una persona, e {richiesteDaPersona === 1 ? "non è contata" : "non sono contate"} qui
            sopra: sono lavoro di qualcuno, non dell&apos;assistente.
          </AlertDescription>
        </Alert>
      )}

      {/*
        ⚠️⚠️ Accanto ai numeri e non in fondo alla pagina. Senza questa riga chi guarda
        conclude che il totale sia «quanto ha lavorato l'assistente contro quanto avete
        lavorato voi», che è una lettura falsa e credibile insieme.
      */}
      <Alert>
        <AlertDescription>
          <strong>Questi numeri contano le scritture via API.</strong> Il lavoro che le persone fanno in questa
          interfaccia non passa da lì e qui non si vede: non è un confronto fra l&apos;assistente e il vostro team. ⚠️ E
          dicono «una persona oppure un&apos;integrazione», non <em>quale</em> integrazione: una chiave identifica lo
          spazio di lavoro, non chi chiama. Con due integrazioni collegate, questi numeri sono la somma delle due.
        </AlertDescription>
      </Alert>
    </div>
  );
}

/**
 * The CRM's words for what was written.
 *
 * ⚠️ Unknown keys fall through to themselves rather than to «altro»: a verb the engine has
 * just learned must appear as itself, even ugly, instead of disappearing into a bucket
 * nobody can act on.
 */
const ETICHETTE: Record<string, string> = {
  activity: "Attività",
  company: "Aziende",
  consent: "Consensi ritirati",
  contact: "Contatti",
  "custom-field": "Campi personalizzati",
  deal: "Trattative chiuse",
  erasure: "Cancellazioni",
  lead: "Lead",
  note: "Note",
  order: "Ordini",
};

function etichetta(chiave: string): string {
  return ETICHETTE[chiave] ?? chiave;
}

function quando(voci: VoceAttivita[]): string {
  const ultima = voci.reduce<Date | null>((max, v) => (v.ultima && (!max || v.ultima > max) ? v.ultima : max), null);
  return ultima ? ultima.toLocaleDateString("it-IT", { day: "numeric", month: "long" }) : "—";
}

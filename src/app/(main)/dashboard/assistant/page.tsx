import { getFormatter, getTranslations } from "next-intl/server";

import { attivitaDellAssistente } from "@/actions/assistant-activity";
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
  const t = await getTranslations("assistantActivity");
  const format = await getFormatter();

  const oggi = new Date();
  const primo = new Date(oggi.getFullYear(), oggi.getMonth(), 1);
  // ⚠️ The last instant of the last day, not its midnight: a range that stops at 00:00
  // loses a whole day and still looks plausible.
  const ultimo = new Date(oggi.getFullYear(), oggi.getMonth() + 1, 0, 23, 59, 59, 999);
  const mese = format.dateTime(primo, { month: "long", year: "numeric" });

  const { voci, richiesteDaPersona } = await attivitaDellAssistente(primo, ultimo);
  const totaleRighe = voci.reduce((s, v) => s + v.righe, 0);
  const totaleRichieste = voci.reduce((s, v) => s + v.richieste, 0);
  const ultima = voci.reduce<Date | null>((max, v) => (v.ultima && (!max || v.ultima > max) ? v.ultima : max), null);

  /**
   * The CRM's words for what was written.
   *
   * ⚠️ Unknown keys fall through to themselves rather than to «other»: a verb the engine has
   * just learned must appear as itself, even ugly, instead of disappearing into a bucket
   * nobody can act on.
   */
  const etichetta = (chiave: string) => (t.has(`entities.${chiave}`) ? t(`entities.${chiave}`) : chiave);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t("subtitle", { month: mese })}</p>
      </div>

      {voci.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("emptyTitle", { month: mese })}</CardTitle>
            <CardDescription>{t("emptyDescription")}</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("rowsTitle")}</CardDescription>
                <CardTitle className="text-4xl tabular-nums">{totaleRighe}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">{t("rowsHint", { month: mese, kinds: voci.length })}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("requestsTitle")}</CardDescription>
                <CardTitle className="text-4xl tabular-nums">{totaleRichieste}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">{t("requestsHint")}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>{t("lastTitle")}</CardDescription>
                <CardTitle className="text-2xl">
                  {ultima ? format.dateTime(ultima, { day: "numeric", month: "long" }) : "—"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-sm">{t("lastHint")}</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("tableTitle")}</CardTitle>
              <CardDescription>{t("tableDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("columns.kind")}</TableHead>
                      <TableHead className="text-right">{t("columns.rows")}</TableHead>
                      <TableHead className="text-right">{t("columns.requests")}</TableHead>
                      <TableHead className="text-right">{t("columns.last")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {voci.map((v) => (
                      <TableRow key={v.entity}>
                        <TableCell className="font-medium">{etichetta(v.entity)}</TableCell>
                        <TableCell className="text-right tabular-nums">{v.righe}</TableCell>
                        <TableCell className="text-right tabular-nums">{v.richieste}</TableCell>
                        <TableCell className="text-right text-muted-foreground tabular-nums">
                          {v.ultima
                            ? format.dateTime(v.ultima, { day: "2-digit", month: "2-digit", year: "numeric" })
                            : "—"}
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
            {t.rich("byPerson", {
              count: richiesteDaPersona,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </AlertDescription>
        </Alert>
      )}

      {/*
        ⚠️⚠️ Next to the numbers and not at the bottom of the page. Without this line whoever
        looks concludes the total is «how much the assistant worked against how much you
        did», which is a reading both false and believable.
      */}
      <Alert>
        <AlertDescription>
          {t.rich("apiOnlyNote", {
            strong: (chunks) => <strong>{chunks}</strong>,
            em: (chunks) => <em>{chunks}</em>,
          })}
        </AlertDescription>
      </Alert>
    </div>
  );
}

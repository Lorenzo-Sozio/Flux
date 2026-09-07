import Link from "next/link";

import { MailIcon, PenSquare, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getEmailTemplates } from "@/actions/marketing";
import { EmptyState } from "@/components/crm/empty-state";
import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { TemplateDeleteButton } from "./_components/template-delete-button";

const CATEGORY_COLORS: Record<string, string> = {
  general: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  welcome: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  followup: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  promotional: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  transactional: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
};

export default async function TemplatesPage() {
  const t = await getTranslations("marketing.templates");
  const tc = await getTranslations("common");
  let templates: Awaited<ReturnType<typeof getEmailTemplates>> = [];
  try {
    templates = await getEmailTemplates();
  } catch (e) {
    console.error("Failed to fetch templates:", e);
  }

  return (
    <div className="space-y-6">
      {/* ⚠️ Wrapping, not shrinking. `min-w-0` stopped the button being pushed off
          the screen, and then the subtitle took its place: three lines of caption
          squeezed into 140px beside a button. The button drops to its own line on
          a phone, and the sentence gets the width it was written for. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-bold text-2xl">
            <MailIcon className="h-6 w-6 text-primary" />
            {t("title")}
          </h1>
          <p className="mt-0.5 text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/marketing/templates/editor">
            <Plus className="mr-1 h-4 w-4" />
            {t("newTemplate")}
          </Link>
        </Button>
      </div>

      {/* ⚠️ Six columns in 343px. The other five lists in the product became
          cards below md and this one did not; the pattern is the shape, not a
          per-page decision. */}
      <ResponsiveRecordList
        cards={
          templates.length === 0 ? (
            <EmptyState
              icon={MailIcon}
              title={t("noTemplates")}
              description={t("noTemplatesDescription")}
              action={
                <Button asChild size="sm">
                  <Link href="/dashboard/marketing/templates/editor">
                    <Plus className="mr-1 h-4 w-4" /> {t("newTemplate")}
                  </Link>
                </Button>
              }
            />
          ) : (
            <RecordCards
              items={templates.map((tmpl) => {
                const bodyKb = tmpl.body ? Math.round(new TextEncoder().encode(tmpl.body).length / 102.4) / 10 : 0;
                return {
                  id: tmpl.id,
                  href: `/dashboard/marketing/templates/editor?id=${tmpl.id}`,
                  title: tmpl.name,
                  subtitle: tmpl.subject,
                  meta: (
                    <>
                      <span
                        className={`rounded px-1.5 py-0.5 font-medium text-[10px] capitalize ${CATEGORY_COLORS[tmpl.category] ?? CATEGORY_COLORS.general}`}
                      >
                        {tmpl.category ?? "general"}
                      </span>
                      {bodyKb > 0 && (
                        <Badge
                          variant={bodyKb > 80 ? "destructive" : "secondary"}
                          className="h-4 font-mono text-[10px]"
                        >
                          {bodyKb} KB
                        </Badge>
                      )}
                      <span className="text-muted-foreground text-xs">
                        {new Date(tmpl.createdAt).toLocaleDateString()}
                      </span>
                    </>
                  ),
                  actions: <TemplateDeleteButton templateId={tmpl.id} />,
                };
              })}
            />
          )
        }
        table={
          <div className="overflow-hidden rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tc("name")}</TableHead>
                  <TableHead>{t("subject")}</TableHead>
                  <TableHead>{tc("category")}</TableHead>
                  <TableHead>{t("size")}</TableHead>
                  <TableHead>{tc("createdAt")}</TableHead>
                  <TableHead className="text-right">{tc("actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.length > 0 ? (
                  templates.map((tmpl) => {
                    const bodyKb = tmpl.body ? Math.round(new TextEncoder().encode(tmpl.body).length / 102.4) / 10 : 0;
                    return (
                      <TableRow key={tmpl.id}>
                        <TableCell>
                          <div>
                            <p className="font-semibold">{tmpl.name}</p>
                            {tmpl.description && (
                              <p className="mt-0.5 text-muted-foreground text-xs">{tmpl.description}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-muted-foreground text-sm">
                          {tmpl.subject}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`rounded px-2 py-1 font-medium text-xs capitalize ${CATEGORY_COLORS[tmpl.category] ?? CATEGORY_COLORS.general}`}
                          >
                            {tmpl.category ?? "general"}
                          </span>
                        </TableCell>
                        <TableCell>
                          {bodyKb > 0 && (
                            <Badge
                              variant={bodyKb > 80 ? "destructive" : "secondary"}
                              className="font-mono text-[10px]"
                            >
                              {bodyKb} KB
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {new Date(tmpl.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button variant="outline" size="sm" asChild className="h-7 gap-1 text-xs">
                              <Link href={`/dashboard/marketing/templates/editor?id=${tmpl.id}`}>
                                <PenSquare className="h-3 w-3" />
                                {tc("edit")}
                              </Link>
                            </Button>
                            <TemplateDeleteButton templateId={tmpl.id} />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="py-16 text-center text-muted-foreground">
                      <MailIcon className="mx-auto mb-3 h-10 w-10 opacity-20" />
                      <p className="font-medium">{t("noTemplates")}</p>
                      <p className="mt-1 text-sm">{t("noTemplatesDescription")}</p>
                      <Button asChild className="mt-4" size="sm">
                        <Link href="/dashboard/marketing/templates/editor">
                          <Plus className="mr-1 h-4 w-4" /> {t("newTemplate")}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        }
      />
    </div>
  );
}

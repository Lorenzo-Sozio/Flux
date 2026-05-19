import Link from "next/link";

import { MailIcon, PenSquare, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { getEmailTemplates } from "@/actions/marketing";
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
  let templates: any[] = [];
  try {
    templates = await getEmailTemplates();
  } catch (e) {
    console.error("Failed to fetch templates:", e);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MailIcon className="w-6 h-6 text-primary" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("subtitle")}</p>
        </div>
        <Button asChild>
          <Link href="/dashboard/marketing/templates/editor">
            <Plus className="h-4 w-4 mr-1" />
            {t("newTemplate")}
          </Link>
        </Button>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tc("name")}</TableHead>
              <TableHead>{t("subject")}</TableHead>
              <TableHead>{tc("category")}</TableHead>
              <TableHead>Size</TableHead>
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
                        {tmpl.description && <p className="text-xs text-muted-foreground mt-0.5">{tmpl.description}</p>}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">{tmpl.subject}</TableCell>
                    <TableCell>
                      <span
                        className={`text-xs px-2 py-1 rounded capitalize font-medium ${CATEGORY_COLORS[tmpl.category] ?? CATEGORY_COLORS.general}`}
                      >
                        {tmpl.category ?? "general"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {bodyKb > 0 && (
                        <Badge variant={bodyKb > 80 ? "destructive" : "secondary"} className="text-[10px] font-mono">
                          {bodyKb} KB
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(tmpl.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end items-center gap-2">
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
                <TableCell colSpan={6} className="text-center py-16 text-muted-foreground">
                  <MailIcon className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  <p className="font-medium">{t("noTemplates")}</p>
                  <p className="text-sm mt-1">{t("noTemplatesDescription")}</p>
                  <Button asChild className="mt-4" size="sm">
                    <Link href="/dashboard/marketing/templates/editor">
                      <Plus className="h-4 w-4 mr-1" /> {t("newTemplate")}
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

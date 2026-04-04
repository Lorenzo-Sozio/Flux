import { getEmailTemplates } from "@/actions/marketing";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MailIcon, PenSquare, Plus } from "lucide-react";
import Link from "next/link";
import { TemplateDeleteButton } from "./_components/template-delete-button";

const CATEGORY_COLORS: Record<string, string> = {
  general:       "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  welcome:       "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  followup:      "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  promotional:   "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  transactional: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
};

export default async function TemplatesPage() {
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
            Email Templates
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Build responsive email templates with the visual drag-and-drop editor.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/marketing/templates/editor">
            <Plus className="h-4 w-4 mr-1" />
            New Template
          </Link>
        </Button>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Subject Line</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.length > 0 ? (
              templates.map((t) => {
                const bodyKb = t.body
                  ? Math.round(new TextEncoder().encode(t.body).length / 102.4) / 10
                  : 0;
                return (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div>
                        <p className="font-semibold">{t.name}</p>
                        {t.description && (
                          <p className="text-xs text-muted-foreground mt-0.5">{t.description}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {t.subject}
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-1 rounded capitalize font-medium ${CATEGORY_COLORS[t.category] ?? CATEGORY_COLORS.general}`}>
                        {t.category ?? "general"}
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
                      {new Date(t.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end items-center gap-2">
                        <Button variant="outline" size="sm" asChild className="h-7 gap-1 text-xs">
                          <Link href={`/dashboard/marketing/templates/editor?id=${t.id}`}>
                            <PenSquare className="h-3 w-3" />
                            Edit
                          </Link>
                        </Button>
                        <TemplateDeleteButton templateId={t.id} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-16 text-muted-foreground">
                  <MailIcon className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  <p className="font-medium">No templates yet</p>
                  <p className="text-sm mt-1">Create your first email template to get started</p>
                  <Button asChild className="mt-4" size="sm">
                    <Link href="/dashboard/marketing/templates/editor">
                      <Plus className="h-4 w-4 mr-1" /> New Template
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

import { getEmailTemplates } from "@/actions/marketing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MailIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TemplateModal } from "@/components/crm/template-modal";
import { TemplateDeleteButton } from "./_components/template-delete-button";

export default async function TemplatesPage() {
  let templates: any[] = [];
  
  try {
    templates = await getEmailTemplates();
  } catch (error) {
    console.error("Failed to fetch templates:", error);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MailIcon className="w-6 h-6 text-primary" />
            Email Templates
          </h1>
          <p className="text-sm text-muted-foreground">Manage your reusable email messages with dynamic placeholders.</p>
        </div>
        <TemplateModal />
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template Name</TableHead>
                  <TableHead>Subject Line</TableHead>
                  <TableHead>Type & Category</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates && templates.length > 0 ? (
                  templates.map((t: any) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-semibold">
                        <div>
                          <p>{t.name}</p>
                          <p className="text-xs text-muted-foreground">{t.description}</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{t.subject}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-100 rounded capitalize">
                            {t.category}
                          </span>
                          {t.isHtml && (
                            <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-100 rounded">
                              HTML
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(t.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <TemplateModal
                            template={{
                              id: t.id,
                              name: t.name,
                              description: t.description,
                              subject: t.subject,
                              body: t.body,
                              isHtml: t.isHtml,
                              category: t.category,
                              previewText: t.previewText,
                              tags: t.tags,
                            }}
                          />
                          <TemplateDeleteButton templateId={t.id} />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-10 text-muted-foreground italic">
                      No templates created yet. Start by creating your first professional email template!
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

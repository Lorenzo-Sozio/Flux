import { getEmailTemplates, deleteEmailTemplate } from "@/actions/marketing";
import { auth } from "@/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlusIcon, PencilIcon, TrashIcon, MailIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TemplateModal } from "@/components/crm/template-modal";
import { revalidatePath } from "next/cache";

export default async function TemplatesPage() {
  const templates = await getEmailTemplates();
  const session = await auth();

  async function handleDelete(templateId: string) {
    "use server";
    await deleteEmailTemplate(templateId);
    revalidatePath("/dashboard/marketing/templates");
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
        <TemplateModal onSuccess={() => revalidatePath("/dashboard/marketing/templates")} />
      </div>

      <div className="grid grid-cols-1 gap-6">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template Name</TableHead>
                  <TableHead>Subject Line</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-semibold">{t.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{t.subject}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <TemplateModal
                          template={{
                            id: t.id,
                            name: t.name,
                            subject: t.subject,
                            body: t.body,
                          }}
                          onSuccess={() => revalidatePath("/dashboard/marketing/templates")}
                        />
                        <form action={async () => { await handleDelete(t.id); }}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:bg-destructive/10"
                            type="submit"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </Button>
                        </form>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {templates.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-10 text-muted-foreground italic">
                      No templates created yet. Start by creating your first reusable email template!
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

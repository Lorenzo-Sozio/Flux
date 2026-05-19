import { notFound } from "next/navigation";

import { eq } from "drizzle-orm";

import { EmailBuilder } from "@/components/email-builder";
import { emailTemplates } from "@/db/schema";
import type { EmailDesign } from "@/lib/email-builder";
import { emptyDesign } from "@/lib/email-builder";
import { getDb } from "@/lib/tenant-context";

interface Props {
  searchParams: Promise<{ id?: string }>;
}

export default async function EmailEditorPage({ searchParams }: Props) {
  const db = await getDb();
  const { id } = await searchParams;

  if (!id) {
    // New template
    return <EmailBuilder initialDesign={emptyDesign()} />;
  }

  const [template] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id));

  if (!template) return notFound();

  let design: EmailDesign | undefined;
  try {
    if ((template as any).design) {
      design = JSON.parse((template as any).design) as EmailDesign;
    }
  } catch {
    design = undefined;
  }

  return (
    <EmailBuilder
      templateId={template.id}
      initialName={template.name}
      initialSubject={template.subject}
      initialCategory={(template as any).category ?? "general"}
      initialDesign={design ?? emptyDesign()}
    />
  );
}

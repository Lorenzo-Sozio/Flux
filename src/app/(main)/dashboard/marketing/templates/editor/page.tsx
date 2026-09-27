import { notFound } from "next/navigation";

import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { EmailBuilder } from "@/components/email-builder";
import { emailTemplates } from "@/db/schema";
import { blockTextDefaults, designFromBody, emptyDesign, parseDesign } from "@/lib/email-builder";
import { getDb } from "@/lib/tenant-context";

interface Props {
  searchParams: Promise<{ id?: string }>;
}

export default async function EmailEditorPage({ searchParams }: Props) {
  const db = await getDb();
  const { id } = await searchParams;
  // A new design is built here rather than in the client, so its block ids do not
  // differ between the server render and hydration.
  const blockText = blockTextDefaults(await getTranslations("marketing.emailBuilder"));

  if (!id) {
    // New template
    return <EmailBuilder initialDesign={emptyDesign(blockText)} />;
  }

  const [template] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, id));

  if (!template) return notFound();

  // ⚠️ The saved blocks, or else the HTML that is really sent — never the placeholder
  // email. Opening a template without a design on the placeholder is how a save used
  // to replace somebody's email with "Your heading here".
  const saved = parseDesign(template.design);
  const design = saved ?? designFromBody(template.body, template.isHtml);

  return (
    <EmailBuilder
      templateId={template.id}
      initialName={template.name}
      initialSubject={template.subject}
      initialCategory={template.category}
      initialDesign={design}
      fromHtml={!saved}
    />
  );
}

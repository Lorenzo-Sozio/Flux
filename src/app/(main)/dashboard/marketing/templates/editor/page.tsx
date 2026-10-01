import { notFound } from "next/navigation";

import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { EmailBuilder } from "@/components/email-builder";
import { emailTemplates } from "@/db/schema";
import { getActor } from "@/lib/auth-guard";
import { brandHeaderHtml } from "@/lib/email-brand";
import { loadEmailBrand, signatureFor } from "@/lib/email-brand-load";
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
  // The Letterhead and Signature blocks as they will be sent: the workspace's, and the signature
  // of whoever is designing (in a campaign, the person who sends it).
  const [brand, actor] = await Promise.all([loadEmailBrand(db).catch(() => null), getActor().catch(() => null)]);
  const brandSample = brand
    ? {
        header: brandHeaderHtml(brand),
        signature: await signatureFor(db, actor?.userId, brand, "full", "it").catch(() => ""),
      }
    : null;

  if (!id) {
    // New template
    return <EmailBuilder initialDesign={emptyDesign(blockText)} brandSample={brandSample} />;
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
      brandSample={brandSample}
    />
  );
}

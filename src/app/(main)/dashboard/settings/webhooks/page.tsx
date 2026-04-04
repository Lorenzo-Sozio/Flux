import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getWebhooks } from "@/actions/webhooks";
import { WebhooksClient } from "./_components/webhooks-client";

export default async function WebhooksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (!["admin", "owner"].includes(role)) redirect("/dashboard/crm");

  const webhookList = await getWebhooks();

  return <WebhooksClient webhooks={webhookList} currentUserId={session.user.id!} />;
}

import { getWebhooks } from "@/actions/webhooks";
import { requirePageCapability } from "@/lib/page-guard";

import { WebhooksClient } from "./_components/webhooks-client";

export default async function WebhooksPage() {
  const actor = await requirePageCapability("webhook:manage", "/dashboard/settings/webhooks");

  const webhookList = await getWebhooks();

  return <WebhooksClient webhooks={webhookList} currentUserId={actor.userId} />;
}

import { getWorkQueue } from "@/actions/next-actions";
import { hasCapability } from "@/lib/auth-guard";
import { requirePageCapability } from "@/lib/page-guard";

import { QueueClient } from "./_components/queue-client";

export default async function WorkQueuePage() {
  await requirePageCapability("record:read", "/dashboard/queue");
  const [items, canWrite] = await Promise.all([getWorkQueue(), hasCapability("record:write")]);
  return <QueueClient items={items} canWrite={canWrite} />;
}

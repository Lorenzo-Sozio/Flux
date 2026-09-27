import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { LOGIN_PATH, requirePageFeature } from "@/lib/page-guard";

import { ChatClient } from "./_components/chat-client";

export default async function ChatPage() {
  const session = await auth();
  if (!session?.user?.id) redirect(LOGIN_PATH);
  await requirePageFeature("chat", "/dashboard/crm");

  return <ChatClient userId={session.user.id} />;
}

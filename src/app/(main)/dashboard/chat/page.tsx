import { redirect } from "next/navigation";

import { auth } from "@/auth";

import { ChatClient } from "./_components/chat-client";

export default async function ChatPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  return <ChatClient userId={session.user.id} />;
}

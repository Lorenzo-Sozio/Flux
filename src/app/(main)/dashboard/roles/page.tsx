import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getAllUsersAction } from "@/actions/auth";
import { RolesClient } from "./_components/roles-client";

export default async function RolesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (!["admin", "owner"].includes(role)) redirect("/dashboard/crm");

  const users = await getAllUsersAction();

  return (
    <RolesClient
      users={users}
      currentUserId={session.user.id!}
      currentUserRole={role}
    />
  );
}

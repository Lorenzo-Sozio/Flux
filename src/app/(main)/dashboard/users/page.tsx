import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getAllUsersAction, getPendingInvitationsAction } from "@/actions/auth";
import { UsersClient } from "./_components/users-client";

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userRole = (session.user as any).role;
  if (!["admin", "owner"].includes(userRole)) redirect("/dashboard/crm");

  const [users, pendingInvitations] = await Promise.all([
    getAllUsersAction(),
    getPendingInvitationsAction(),
  ]);

  return (
    <UsersClient
      users={users}
      pendingInvitations={pendingInvitations}
      currentUserId={session.user.id!}
      currentUserRole={userRole}
    />
  );
}

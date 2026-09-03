import { getAllUsersAction, getPendingInvitationsAction } from "@/actions/auth";
import { requirePageCapability } from "@/lib/page-guard";

import { UsersClient } from "./_components/users-client";

export default async function UsersPage() {
  // The workspace role, not the platform staff field. Reading the latter is what
  // locked workspace owners out of their own admin screens (audit rilievo P-01).
  const actor = await requirePageCapability("user:read", "/dashboard/users");

  const [users, pendingInvitations] = await Promise.all([getAllUsersAction(), getPendingInvitationsAction()]);

  return (
    <UsersClient
      users={users}
      pendingInvitations={pendingInvitations}
      currentUserId={actor.userId}
      currentUserRole={actor.isPlatformStaff ? "owner" : actor.tenantRole}
    />
  );
}

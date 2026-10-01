import { getAllUsersAction, getPendingInvitationsAction } from "@/actions/auth";
import { requirePageCapability } from "@/lib/page-guard";
import { can } from "@/lib/permissions";
import { readVisibilityMode } from "@/lib/record-visibility";
import { getDb } from "@/lib/tenant-context";

import { RecordVisibilityCard } from "./_components/record-visibility-card";
import { UsersClient } from "./_components/users-client";

export default async function UsersPage() {
  // The workspace role, not the platform staff field. Reading the latter is what
  // locked workspace owners out of their own admin screens (audit rilievo P-01).
  const actor = await requirePageCapability("user:read", "/dashboard/users");
  const managesUsers = can(actor, "user:manage");

  const [users, pendingInvitations, visibility] = await Promise.all([
    getAllUsersAction(),
    getPendingInvitationsAction(),
    managesUsers ? getDb().then(readVisibilityMode) : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <UsersClient
        users={users}
        pendingInvitations={pendingInvitations}
        currentUserId={actor.userId}
        currentUserRole={actor.isPlatformStaff ? "owner" : actor.tenantRole}
      />
      {visibility && <RecordVisibilityCard initial={visibility} />}
    </div>
  );
}

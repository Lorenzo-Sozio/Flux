"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Shield, Crown, Pencil, Eye } from "lucide-react";

import { updateUserRoleAction } from "@/actions/auth";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface User {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  image: string | null;
}

interface Props {
  users: User[];
  currentUserId: string;
  currentUserRole: string;
}

const ROLES = [
  {
    id: "owner",
    label: "Owner",
    icon: Crown,
    color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    description: "Full control over the workspace. Can manage all settings, users, and data.",
    permissions: [
      "All admin permissions",
      "Transfer workspace ownership",
      "Delete workspace",
      "Manage billing",
    ],
  },
  {
    id: "admin",
    label: "Admin",
    icon: Shield,
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    description: "Can manage users, roles, settings, and all CRM data.",
    permissions: [
      "All user permissions",
      "Invite and manage users",
      "Assign roles",
      "Configure settings & custom fields",
      "Manage webhooks and automation",
    ],
  },
  {
    id: "user",
    label: "User",
    icon: Pencil,
    color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    description: "Can create, edit and delete CRM records. Cannot manage users or settings.",
    permissions: [
      "All viewer permissions",
      "Create and edit records",
      "Delete records",
      "Send emails and quotes",
      "Manage tasks and pipeline",
    ],
  },
  {
    id: "viewer",
    label: "Viewer",
    icon: Eye,
    color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    description: "Read-only access. Cannot create, edit or delete any records.",
    permissions: [
      "View contacts, companies, leads",
      "View pipeline and deals",
      "View quotes and orders",
      "View reports and analytics",
    ],
  },
];

const ASSIGNABLE_ROLES = ["admin", "user", "viewer"];

function getRoleConfig(roleId: string) {
  return ROLES.find((r) => r.id === roleId) ?? ROLES[3];
}

function RoleBadge({ role }: { role: string }) {
  const cfg = getRoleConfig(role);
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cfg.color}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function UserCard({
  user,
  currentUserId,
  currentUserRole,
  onRoleChange,
  isPending,
}: {
  user: User;
  currentUserId: string;
  currentUserRole: string;
  onRoleChange: (userId: string, role: string) => void;
  isPending: boolean;
}) {
  const isSelf = user.id === currentUserId;
  const isOwner = user.role === "owner";
  // owners can change anyone except themselves; admins can only change non-owner/non-admin users
  const canChange =
    !isSelf &&
    !isOwner &&
    (currentUserRole === "owner" ||
      (currentUserRole === "admin" && user.role !== "admin"));

  const initials = (user.name ?? user.email ?? "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex items-center gap-3 min-w-0">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{user.name ?? "—"}</p>
          <p className="text-xs text-muted-foreground truncate">{user.email}</p>
        </div>
      </div>
      <div className="shrink-0">
        {canChange ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-auto p-0" disabled={isPending}>
                <RoleBadge role={user.role ?? "viewer"} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(currentUserRole === "owner" ? ["owner", ...ASSIGNABLE_ROLES] : ASSIGNABLE_ROLES).map((r) => (
                <DropdownMenuItem
                  key={r}
                  onSelect={() => onRoleChange(user.id, r)}
                  className={user.role === r ? "bg-muted" : ""}
                >
                  <RoleBadge role={r} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <RoleBadge role={user.role ?? "viewer"} />
        )}
      </div>
    </div>
  );
}

export function RolesClient({ users: initialUsers, currentUserId, currentUserRole }: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);

  function handleRoleChange(userId: string, newRole: string) {
    setPending(true);
    startTransition(async () => {
      try {
        await updateUserRoleAction(userId, newRole);
        setUsers((prev) =>
          prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
        );
        toast.success("Role updated");
      } catch {
        toast.error("Failed to update role");
      } finally {
        setPending(false);
      }
    });
  }

  const usersByRole = ROLES.map((role) => ({
    ...role,
    members: users.filter((u) => (u.role ?? "viewer") === role.id),
  }));

  return (
    <div className="p-8 space-y-8 w-full">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Roles & Permissions</h1>
        <p className="text-muted-foreground mt-1">
          Manage user roles and understand what each role can do.
        </p>
      </div>

      {/* Permission Matrix */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Permission Overview</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ROLES.map((role) => {
            const Icon = role.icon;
            return (
              <Card key={role.id} className="border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 text-sm font-semibold px-2.5 py-1 rounded-full ${role.color}`}>
                      <Icon className="h-3.5 w-3.5" />
                      {role.label}
                    </span>
                  </CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">{role.description}</p>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5">
                    {role.permissions.map((perm) => (
                      <li key={perm} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <span className="mt-0.5 text-green-500">✓</span>
                        {perm}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <Separator />

      {/* Users by Role */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Users by Role</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {usersByRole.map((role) => {
            const Icon = role.icon;
            return (
              <div key={role.id}>
                <div className="flex items-center gap-2 mb-3">
                  <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${role.color}`}>
                    <Icon className="h-3 w-3" />
                    {role.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {role.members.length} user{role.members.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="rounded-lg border divide-y">
                  {role.members.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No users</p>
                  ) : (
                    role.members.map((user) => (
                      <div key={user.id} className="px-3">
                        <UserCard
                          user={user}
                          currentUserId={currentUserId}
                          currentUserRole={currentUserRole}
                          onRoleChange={handleRoleChange}
                          isPending={pending}
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

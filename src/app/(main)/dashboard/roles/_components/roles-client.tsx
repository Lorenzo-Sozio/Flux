"use client";

import { useState, useTransition } from "react";

import { Crown, Eye, Pencil, Shield } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { updateUserRoleAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

type RoleId = "owner" | "admin" | "user" | "viewer";

const ROLES: { id: RoleId; icon: React.ElementType; color: string }[] = [
  {
    id: "owner",
    icon: Crown,
    color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  },
  {
    id: "admin",
    icon: Shield,
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  },
  {
    id: "user",
    icon: Pencil,
    color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  },
  {
    id: "viewer",
    icon: Eye,
    color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  },
];

const ASSIGNABLE_ROLES: RoleId[] = ["admin", "user", "viewer"];

function getRoleConfig(roleId: string) {
  return ROLES.find((r) => r.id === roleId) ?? ROLES[3];
}

function RoleBadge({ role }: { role: string }) {
  const t = useTranslations("roles");
  const cfg = getRoleConfig(role);
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs ${cfg.color}`}>
      <Icon className="h-3 w-3" />
      {t(`roleLabel.${role as RoleId}`)}
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
    !isSelf && !isOwner && (currentUserRole === "owner" || (currentUserRole === "admin" && user.role !== "admin"));

  const initials = (user.name ?? user.email ?? "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary text-sm">
          {initials}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium text-sm">{user.name ?? "—"}</p>
          <p className="truncate text-muted-foreground text-xs">{user.email}</p>
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
              {(currentUserRole === "owner" ? (["owner", ...ASSIGNABLE_ROLES] as RoleId[]) : ASSIGNABLE_ROLES).map(
                (r) => (
                  <DropdownMenuItem
                    key={r}
                    onSelect={() => onRoleChange(user.id, r)}
                    className={user.role === r ? "bg-muted" : ""}
                  >
                    <RoleBadge role={r} />
                  </DropdownMenuItem>
                ),
              )}
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
  const t = useTranslations("roles");
  const [users, setUsers] = useState(initialUsers);
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);

  function handleRoleChange(userId: string, newRole: string) {
    setPending(true);
    startTransition(async () => {
      try {
        await updateUserRoleAction(userId, newRole);
        setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
        toast.success(t("roleUpdated"));
      } catch {
        toast.error(t("roleUpdateFailed"));
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
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight sm:text-3xl">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Permission Matrix */}
      <section>
        <h2 className="mb-4 font-semibold text-lg">{t("permissionOverview")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((role) => {
            const Icon = role.icon;
            const perms = t.raw(`rolePerms.${role.id}`) as string[];
            return (
              <Card key={role.id} className="border">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold text-sm ${role.color}`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {t(`roleLabel.${role.id}`)}
                    </span>
                  </CardTitle>
                  <p className="mt-1 text-muted-foreground text-xs">{t(`roleDesc.${role.id}`)}</p>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-1.5">
                    {perms.map((perm) => (
                      <li key={perm} className="flex items-start gap-1.5 text-muted-foreground text-xs">
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
        <h2 className="mb-4 font-semibold text-lg">{t("usersByRole")}</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {usersByRole.map((role) => {
            const Icon = role.icon;
            return (
              <div key={role.id}>
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-xs ${role.color}`}
                  >
                    <Icon className="h-3 w-3" />
                    {t(`roleLabel.${role.id}`)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("userCount", { count: role.members.length })}
                  </span>
                </div>
                <div className="divide-y rounded-lg border">
                  {role.members.length === 0 ? (
                    <p className="py-4 text-center text-muted-foreground text-xs">{t("noUsers")}</p>
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

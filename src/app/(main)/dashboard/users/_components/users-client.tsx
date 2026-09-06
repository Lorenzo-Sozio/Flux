"use client";

import { useEffect, useState } from "react";

import {
  Check,
  ChevronDown,
  Copy,
  Crown,
  Eye,
  Info,
  KeyRound,
  Mail,
  Pencil,
  Plus,
  RotateCcw,
  Shield,
  Trash2,
  UserCog,
  Users,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  adminSendPasswordResetAction,
  changePasswordAction,
  deleteUserAction,
  inviteUserAction,
  updateUserRoleAction,
} from "@/actions/auth";
import { getUserGroups } from "@/actions/user-groups";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { assignableRoles, normalizeTenantRole, type TenantRole } from "@/lib/permissions";
import { getInitials } from "@/lib/utils";

import { GroupModal } from "./group-modal";

type User = {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  emailVerified: Date | null;
  image: string | null;
};

type Invitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
  createdAt: Date;
};

const _ROLE_COLORS: Record<string, string> = {
  owner: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  admin: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  editor: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  viewer: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200",
};

const ROLES: { id: TenantRole; icon: React.ElementType; color: string }[] = [
  { id: "owner", icon: Crown, color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  { id: "admin", icon: Shield, color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400" },
  { id: "editor", icon: Pencil, color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  { id: "viewer", icon: Eye, color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
];

function RoleSelector({
  userId,
  role,
  canChange,
  availableRoles,
  onRoleChange,
}: {
  userId: string;
  role: string;
  canChange: boolean;
  availableRoles: TenantRole[];
  onRoleChange: (userId: string, role: string) => void;
}) {
  const tr = useTranslations("roles");
  const cfg = ROLES.find((r) => r.id === role) ?? ROLES[3];
  const Icon = cfg.icon;

  const pill = (
    <span
      className={`inline-flex select-none items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-xs ${cfg.color}`}
    >
      <Icon className="h-3 w-3" />
      {tr(`roleLabel.${cfg.id}`)}
    </span>
  );

  if (!canChange) return pill;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 font-medium text-xs transition-opacity hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${cfg.color}`}
        >
          <Icon className="h-3 w-3" />
          {tr(`roleLabel.${cfg.id}`)}
          <ChevronDown className="ml-0.5 h-3 w-3 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44 p-1">
        {availableRoles.map((r) => {
          const rc = ROLES.find((x) => x.id === r) ?? ROLES[3];
          const RIcon = rc.icon;
          const isActive = r === role;
          return (
            <DropdownMenuItem
              key={r}
              onSelect={() => onRoleChange(userId, r)}
              className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5"
            >
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium text-xs ${rc.color}`}
              >
                <RIcon className="h-3 w-3" />
                {tr(`roleLabel.${rc.id}`)}
              </span>
              {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface Props {
  users: User[];
  pendingInvitations: Invitation[];
  currentUserId: string;
  currentUserRole: string;
}

type Group = Awaited<ReturnType<typeof getUserGroups>>[number];

export function UsersClient({
  users: initialUsers,
  pendingInvitations: initialInvitations,
  currentUserId,
  currentUserRole,
}: Props) {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const tr = useTranslations("roles");
  const [users, setUsers] = useState(initialUsers);
  const [invitations] = useState(initialInvitations);
  const [groups, setGroups] = useState<Group[]>([]);

  useEffect(() => {
    getUserGroups()
      .then(setGroups)
      // Groups are a secondary panel; failing to load them must not take the
      // user list down with them.
      // biome-ignore lint/suspicious/noEmptyBlockStatements: non-critical panel
      .catch(() => {});
  }, []);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TenantRole>("editor");
  const [isInviting, setIsInviting] = useState(false);
  const [fallbackInviteUrl, setFallbackInviteUrl] = useState<string | null>(null);

  // Change own password
  const [changePwOpen, setChangePwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [isChangingPw, setIsChangingPw] = useState(false);

  // Admin reset password
  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetFallbackUrl, setResetFallbackUrl] = useState<string | null>(null);
  const [isSendingReset, setIsSendingReset] = useState(false);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setIsInviting(true);
    try {
      const result = await inviteUserAction({
        email: inviteEmail,
        role: inviteRole,
      });

      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }

      if (!result.success && "inviteUrl" in result && result.inviteUrl) {
        setFallbackInviteUrl(result.inviteUrl);
        toast.warning(t("inviteDialog.deliveryFailed"));
        return;
      }

      toast.success(`${t("inviteDialog.send")} → ${inviteEmail}`);
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("editor");
      setFallbackInviteUrl(null);
    } catch (err: any) {
      toast.error(err?.message ?? tc("errorOccurred"));
    } finally {
      setIsInviting(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const result = await updateUserRoleAction(userId, newRole);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
      toast.success(t("updateSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc("updateError"));
    }
  };

  const handleDelete = async (userId: string) => {
    if (!confirm(tc("confirmDelete"))) return;
    try {
      const result = await deleteUserAction(userId);
      if ("error" in result && result.error) {
        toast.error(result.error);
        return;
      }
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      toast.success(t("deleteSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc("deleteError"));
    }
  };

  const handleChangePassword = async () => {
    if (newPw !== confirmPw) {
      toast.error("Passwords do not match.");
      return;
    }
    if (newPw.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    setIsChangingPw(true);
    try {
      const result = await changePasswordAction({ currentPassword: currentPw, newPassword: newPw });
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      toast.success("Password changed successfully.");
      setChangePwOpen(false);
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch {
      toast.error(tc("errorOccurred"));
    } finally {
      setIsChangingPw(false);
    }
  };

  const handleAdminSendReset = async (user: User) => {
    setResetTarget(user);
    setResetFallbackUrl(null);
    setIsSendingReset(true);
    try {
      const result = await adminSendPasswordResetAction(user.id);
      if (result.success) {
        toast.success(`${t("resetFallback.title")} → ${user.email}`);
        setResetTarget(null);
      } else if ("resetUrl" in result && result.resetUrl) {
        setResetFallbackUrl(result.resetUrl as string);
        toast.warning("Email not delivered — copy the link below.");
      } else if ("error" in result) {
        toast.error(result.error as string);
        setResetTarget(null);
      }
    } catch {
      toast.error(tc("errorOccurred"));
      setResetTarget(null);
    } finally {
      setIsSendingReset(false);
    }
  };

  // Nobody may hand out a role above their own — enforced again server-side.
  const availableRoles = assignableRoles(currentUserRole);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-bold text-2xl tracking-tight">{t("teamMembers")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          {t("newUser")}
        </Button>
      </div>

      {/* Role management notice for non-admins */}
      {currentUserRole === "editor" || currentUserRole === "viewer" ? (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-blue-700 text-sm dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("roleManagementNotice")}</span>
        </div>
      ) : null}

      {/* Active Users */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5" />
            {t("activeUsersCard", { count: users.length })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.user")}</TableHead>
                <TableHead>{t("columns.role")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                {currentUserRole !== "viewer" && <TableHead className="text-right">{t("columns.actions")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={user.image ?? undefined} />
                        <AvatarFallback className="text-xs">
                          {getInitials(user.name ?? user.email ?? "?")}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-sm">{user.name ?? "—"}</p>
                        <p className="text-muted-foreground text-xs">{user.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <RoleSelector
                      userId={user.id}
                      role={user.role}
                      canChange={
                        (currentUserRole === "owner" || currentUserRole === "admin") &&
                        user.id !== currentUserId &&
                        !(user.role === "owner" && currentUserRole !== "owner")
                      }
                      availableRoles={availableRoles}
                      onRoleChange={handleRoleChange}
                    />
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.emailVerified ? "default" : "secondary"}>
                      {user.emailVerified ? t("verified") : t("unverified")}
                    </Badge>
                  </TableCell>
                  {currentUserRole !== "viewer" && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {user.id === currentUserId ? (
                          // Own row: change password
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Change password"
                            onClick={() => setChangePwOpen(true)}
                          >
                            <KeyRound className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <>
                            {/* Admin: send password reset */}
                            {(currentUserRole === "owner" || currentUserRole === "admin") && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                title="Send password reset"
                                onClick={() => handleAdminSendReset(user)}
                                disabled={isSendingReset && resetTarget?.id === user.id}
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => handleDelete(user.id)}
                              title="Delete user"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              {t("pendingInvitationsCard", { count: invitations.length })}
            </CardTitle>
            <CardDescription>{t("pendingInvitationsDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.email")}</TableHead>
                  <TableHead>{t("columns.role")}</TableHead>
                  <TableHead>{t("columns.expires")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {inv.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Role Permissions Matrix */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{tr("permissionOverview")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {ROLES.map((r) => {
              const Icon = r.icon;
              const perms = tr.raw(`rolePerms.${r.id}`) as string[];
              return (
                <div key={r.id} className="rounded-lg border p-3">
                  <span
                    className={`mb-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-semibold text-xs ${r.color}`}
                  >
                    <Icon className="h-3 w-3" />
                    {tr(`roleLabel.${r.id}`)}
                  </span>
                  <p className="mb-2 text-muted-foreground text-xs">{tr(`roleDesc.${r.id}`)}</p>
                  <ul className="space-y-1">
                    {perms.map((perm) => (
                      <li key={perm} className="flex items-start gap-1.5 text-muted-foreground text-xs">
                        <span className="mt-0.5 text-green-500">✓</span>
                        {perm}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── User Groups ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t("userGroups", { count: groups.length })}
            </CardTitle>
            {["admin", "owner"].includes(currentUserRole) && (
              <GroupModal onSaved={() => getUserGroups().then(setGroups)}>
                <Button size="sm" variant="outline">
                  <Plus className="mr-2 h-3.5 w-3.5" />
                  {t("newGroup")}
                </Button>
              </GroupModal>
            )}
          </div>
          <CardDescription className="text-xs">{t("userGroupsDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {groups.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">{t("noGroups")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {groups.map((g) => (
                <div key={g.id} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: g.color }} />
                    <span className="flex-1 truncate font-medium text-sm">{g.name}</span>
                    {["admin", "owner"].includes(currentUserRole) && (
                      <GroupModal
                        group={{ ...g, description: g.description ?? null }}
                        onSaved={() => getUserGroups().then(setGroups)}
                      >
                        <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" aria-label={tc("edit")}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                      </GroupModal>
                    )}
                  </div>
                  {g.description && <p className="line-clamp-2 text-muted-foreground text-xs">{g.description}</p>}
                  <div className="flex flex-wrap gap-1">
                    {g.members.slice(0, 4).map((m) => (
                      <Badge key={m.id} variant="secondary" className="h-4 px-1.5 py-0 text-[10px]">
                        {m.name || m.email || "—"}
                      </Badge>
                    ))}
                    {g.members.length > 4 && (
                      <Badge variant="outline" className="h-4 px-1.5 py-0 text-[10px]">
                        {t("moreMembers", { count: g.members.length - 4 })}
                      </Badge>
                    )}
                    {g.members.length === 0 && (
                      <span className="text-[10px] text-muted-foreground">{t("noMembers")}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Invite Dialog */}
      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) setFallbackInviteUrl(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("inviteDialog.title")}</DialogTitle>
            <DialogDescription>{t("inviteDialog.desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">{t("inviteDialog.emailLabel")}</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder={t("inviteDialog.emailPlaceholder")}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={!!fallbackInviteUrl}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">{t("inviteDialog.roleLabel")}</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(normalizeTenantRole(v))}
                disabled={!!fallbackInviteUrl}
              >
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableRoles
                    .filter((r) => r !== "owner")
                    .map((r) => (
                      <SelectItem key={r} value={r} className="capitalize">
                        {r}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            {fallbackInviteUrl && (
              <div className="space-y-2 rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-950/30">
                <p className="font-medium text-orange-800 text-sm dark:text-orange-300">
                  {t("inviteDialog.deliveryFailed")}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 select-all truncate rounded border bg-background px-2 py-1.5 text-xs">
                    {fallbackInviteUrl}
                  </code>
                  <Button
                    size="icon"
                    variant="outline"
                    className="h-8 w-8 shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(fallbackInviteUrl);
                      toast.success(tc("copy"));
                    }}
                    title={tc("copy")}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">{t("inviteDialog.emailConfig")}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setInviteOpen(false);
                setFallbackInviteUrl(null);
              }}
            >
              {fallbackInviteUrl ? t("inviteDialog.close") : tc("cancel")}
            </Button>
            {!fallbackInviteUrl && (
              <Button onClick={handleInvite} disabled={isInviting || !inviteEmail}>
                {isInviting ? t("inviteDialog.sending") : t("inviteDialog.send")}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Change Own Password Dialog ────────────────────────────────────── */}
      <Dialog
        open={changePwOpen}
        onOpenChange={(o) => {
          setChangePwOpen(o);
          if (!o) {
            setCurrentPw("");
            setNewPw("");
            setConfirmPw("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("changePw.title")}</DialogTitle>
            <DialogDescription>{t("changePw.desc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("changePw.current")}</Label>
              <Input
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                autoComplete="current-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("changePw.new")}</Label>
              <Input
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("changePw.confirm")}</Label>
              <Input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangePwOpen(false)}>
              {tc("cancel")}
            </Button>
            <Button onClick={handleChangePassword} disabled={isChangingPw || !currentPw || !newPw || !confirmPw}>
              {isChangingPw ? t("changePw.saving") : t("changePw.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Admin: Reset Password Fallback Dialog ─────────────────────────── */}
      <Dialog
        open={!!resetFallbackUrl}
        onOpenChange={(o) => {
          if (!o) {
            setResetFallbackUrl(null);
            setResetTarget(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("resetFallback.title")}</DialogTitle>
            <DialogDescription>
              The reset link was generated but could not be emailed to <strong>{resetTarget?.email}</strong>. Share it
              manually:
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 select-all truncate break-all rounded border bg-muted px-2 py-1.5 text-xs">
                {resetFallbackUrl}
              </code>
              <Button
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                onClick={() => {
                  navigator.clipboard.writeText(resetFallbackUrl!);
                  toast.success(tc("copy"));
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">{t("resetFallback.expires")}</p>
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setResetFallbackUrl(null);
                setResetTarget(null);
              }}
            >
              {tc("close")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

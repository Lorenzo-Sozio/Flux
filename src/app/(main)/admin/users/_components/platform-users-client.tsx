"use client";

import { useState, useTransition } from "react";

import { Building2, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deletePlatformUser, type PlatformUser, updatePlatformUserRole } from "@/actions/platform-users";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

function initials(name: string | null, email: string | null): string {
  const src = name ?? email ?? "?";
  return src.slice(0, 2).toUpperCase();
}

const TENANT_ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

const TENANT_ROLE_COLOR: Record<string, string> = {
  owner: "bg-purple-100 text-purple-800",
  admin: "bg-blue-100 text-blue-800",
  editor: "bg-gray-100 text-gray-700",
  viewer: "bg-gray-50 text-gray-500",
};

interface Props {
  users: PlatformUser[];
  currentUserId: string;
  currentUserRole: string;
}

export function PlatformUsersClient({ users: initialUsers, currentUserId, currentUserRole }: Props) {
  const [userList, setUserList] = useState<PlatformUser[]>(initialUsers);
  const [roles, setRoles] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialUsers.map((u) => [u.id, u.role])),
  );
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const isOwner = currentUserRole === "owner";

  function handleRoleChange(userId: string, newRole: string) {
    setRoles((prev) => ({ ...prev, [userId]: newRole }));
  }

  function handleSave(userId: string) {
    setSaving(userId);
    startTransition(async () => {
      try {
        await updatePlatformUserRole(userId, roles[userId]);
        toast.success("Ruolo aggiornato.");
        // Sync the stored role so isDirty resets
        setUserList((prev) => prev.map((u) => (u.id === userId ? { ...u, role: roles[userId] } : u)));
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Errore durante l'aggiornamento.");
        const original = userList.find((u) => u.id === userId)?.role;
        if (original) setRoles((prev) => ({ ...prev, [userId]: original }));
      } finally {
        setSaving(null);
      }
    });
  }

  function handleDeleteConfirm(userId: string) {
    setDeleting(userId);
    setConfirmDelete(null);
    startTransition(async () => {
      try {
        await deletePlatformUser(userId);
        setUserList((prev) => prev.filter((u) => u.id !== userId));
        toast.success("Utente eliminato dalla piattaforma.");
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Errore durante l'eliminazione.");
      } finally {
        setDeleting(null);
      }
    });
  }

  return (
    <TooltipProvider>
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50">
              <TableHead className="w-[280px]">Utente</TableHead>
              <TableHead className="w-[120px]">Auth</TableHead>
              <TableHead>Tenant</TableHead>
              <TableHead className="w-[160px]">Ruolo piattaforma</TableHead>
              <TableHead className="w-[80px]" />
              <TableHead className="w-[120px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {userList.map((user) => {
              const currentRole = roles[user.id] ?? user.role;
              const originalRole = user.role;
              const isDirty = currentRole !== originalRole;
              const isSelf = user.id === currentUserId;
              const isSaving = saving === user.id && isPending;
              const isDeleting = deleting === user.id && isPending;
              const isConfirming = confirmDelete === user.id;
              const tenantCount = user.tenantMemberships.length;

              // An admin cannot touch owner-role operations
              const canEditRole =
                isOwner ||
                // admins can only change non-owner users to non-owner roles
                (user.role !== "owner" && currentRole !== "owner");

              return (
                <TableRow key={user.id} className={isDeleting ? "opacity-50" : ""}>
                  {/* User info */}
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={user.image ?? undefined} />
                        <AvatarFallback className="bg-gray-100 text-xs">
                          {initials(user.name, user.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-gray-900 text-sm">
                          {user.name ?? <span className="text-gray-400 italic">Nessun nome</span>}
                          {isSelf && <span className="ml-1.5 font-normal text-gray-400 text-xs">(tu)</span>}
                        </p>
                        <p className="truncate text-gray-500 text-xs">{user.email}</p>
                      </div>
                    </div>
                  </TableCell>

                  {/* Auth method */}
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {user.hasPassword && (
                        <Badge variant="outline" className="font-normal text-xs">
                          Password
                        </Badge>
                      )}
                      {user.hasGoogle && (
                        <Badge variant="outline" className="font-normal text-xs">
                          Google
                        </Badge>
                      )}
                      {!user.hasPassword && !user.hasGoogle && <span className="text-gray-400 text-xs">—</span>}
                    </div>
                  </TableCell>

                  {/* Tenant memberships */}
                  <TableCell>
                    {tenantCount === 0 ? (
                      <span className="text-gray-400 text-xs italic">Nessun tenant</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {user.tenantMemberships.slice(0, 3).map((m) => (
                          <Tooltip key={m.tenantId}>
                            <TooltipTrigger asChild>
                              <span
                                className={`inline-flex cursor-default items-center gap-1 rounded px-1.5 py-0.5 font-medium text-[11px] ${TENANT_ROLE_COLOR[m.tenantRole] ?? "bg-gray-100 text-gray-700"}`}
                              >
                                <Building2 className="h-3 w-3 shrink-0" />
                                {m.tenantName}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              Ruolo: {TENANT_ROLE_LABEL[m.tenantRole] ?? m.tenantRole} · {m.subdomain}
                            </TooltipContent>
                          </Tooltip>
                        ))}
                        {tenantCount > 3 && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex cursor-default items-center rounded bg-gray-100 px-1.5 py-0.5 font-medium text-[11px] text-gray-600">
                                +{tenantCount - 3}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-[200px] text-xs">
                              {user.tenantMemberships
                                .slice(3)
                                .map((m) => m.tenantName)
                                .join(", ")}
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    )}
                  </TableCell>

                  {/* Role selector */}
                  <TableCell>
                    {canEditRole ? (
                      <Select
                        value={currentRole}
                        onValueChange={(val) => handleRoleChange(user.id, val)}
                        disabled={isSaving || isDeleting}
                      >
                        <SelectTrigger className="h-8 w-[140px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {/* Owner option: only shown to owners */}
                          {isOwner && (
                            <SelectItem value="owner">
                              <div className="flex items-center gap-2">
                                <Badge variant="default" className="px-1 py-0 text-[10px]">
                                  Owner
                                </Badge>
                                <span className="text-gray-500 text-xs">Controllo totale</span>
                              </div>
                            </SelectItem>
                          )}
                          <SelectItem value="admin">
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                                Admin
                              </Badge>
                              <span className="text-gray-500 text-xs">Accesso admin</span>
                            </div>
                          </SelectItem>
                          <SelectItem value="user">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="px-1 py-0 text-[10px]">
                                Utente
                              </Badge>
                              <span className="text-gray-500 text-xs">Solo CRM</span>
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      // Admin sees owner rows as read-only
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex cursor-not-allowed items-center gap-1.5 opacity-60">
                            <Badge variant="default" className="px-1 py-0 text-[10px]">
                              Owner
                            </Badge>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          Solo un owner può modificare il ruolo di altri owner
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </TableCell>

                  {/* Save button */}
                  <TableCell>
                    {isDirty && canEditRole && (
                      <Button
                        size="sm"
                        variant="default"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => handleSave(user.id)}
                        disabled={isSaving || isDeleting}
                      >
                        <Save className="h-3.5 w-3.5" />
                        {isSaving ? "…" : "Salva"}
                      </Button>
                    )}
                  </TableCell>

                  {/* Delete button */}
                  <TableCell>
                    {!isSelf &&
                      (isOwner || user.role !== "owner") &&
                      (isConfirming ? (
                        <div className="flex flex-col gap-1">
                          {tenantCount > 0 && (
                            <p className="text-[10px] text-red-600 leading-tight">Rimosso da {tenantCount} tenant</p>
                          )}
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 px-2 text-xs"
                              onClick={() => handleDeleteConfirm(user.id)}
                              disabled={isDeleting}
                            >
                              Conferma
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => setConfirmDelete(null)}
                            >
                              Annulla
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          onClick={() => setConfirmDelete(user.id)}
                          disabled={isDeleting}
                          title={
                            tenantCount > 0 ? `Elimina utente (membro di ${tenantCount} tenant)` : "Elimina utente"
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ))}
                  </TableCell>
                </TableRow>
              );
            })}

            {userList.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-gray-400 text-sm">
                  Nessun utente trovato.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </TooltipProvider>
  );
}

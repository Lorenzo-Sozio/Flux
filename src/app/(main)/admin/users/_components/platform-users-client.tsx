"use client";

import { useState, useTransition } from "react";

import { Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deletePlatformUser, type PlatformUser, updatePlatformUserRole } from "@/actions/platform-users";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function initials(name: string | null, email: string | null): string {
  const src = name ?? email ?? "?";
  return src.slice(0, 2).toUpperCase();
}

interface Props {
  users: PlatformUser[];
  currentUserId: string;
}

export function PlatformUsersClient({ users: initialUsers, currentUserId }: Props) {
  const [userList, setUserList] = useState<PlatformUser[]>(initialUsers);
  const [roles, setRoles] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialUsers.map((u) => [u.id, u.role])),
  );
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  function handleRoleChange(userId: string, newRole: string) {
    setRoles((prev) => ({ ...prev, [userId]: newRole }));
  }

  function handleSave(userId: string) {
    setSaving(userId);
    startTransition(async () => {
      try {
        await updatePlatformUserRole(userId, roles[userId]);
        toast.success("Ruolo aggiornato.");
      } catch (err: any) {
        toast.error(err?.message ?? "Errore durante l'aggiornamento.");
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
        toast.success("Utente eliminato.");
      } catch (err: any) {
        toast.error(err?.message ?? "Errore durante l'eliminazione.");
      } finally {
        setDeleting(null);
      }
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-gray-50">
            <TableHead className="w-[300px]">Utente</TableHead>
            <TableHead>Auth</TableHead>
            <TableHead className="w-[160px]">Ruolo piattaforma</TableHead>
            <TableHead className="w-[80px]" />
            <TableHead className="w-[100px]" />
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

            return (
              <TableRow key={user.id} className={isDeleting ? "opacity-50" : ""}>
                {/* User info */}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user.image ?? undefined} />
                      <AvatarFallback className="text-xs bg-gray-100">{initials(user.name, user.email)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {user.name ?? <span className="text-gray-400 italic">Nessun nome</span>}
                        {isSelf && <span className="ml-1.5 text-xs font-normal text-gray-400">(tu)</span>}
                      </p>
                      <p className="text-xs text-gray-500 truncate">{user.email}</p>
                    </div>
                  </div>
                </TableCell>

                {/* Auth method */}
                <TableCell>
                  <div className="flex gap-1.5">
                    {user.hasPassword && (
                      <Badge variant="outline" className="text-xs font-normal">
                        Password
                      </Badge>
                    )}
                    {user.hasGoogle && (
                      <Badge variant="outline" className="text-xs font-normal">
                        Google
                      </Badge>
                    )}
                    {!user.hasPassword && !user.hasGoogle && <span className="text-xs text-gray-400">—</span>}
                  </div>
                </TableCell>

                {/* Role selector */}
                <TableCell>
                  <Select
                    value={currentRole}
                    onValueChange={(val) => handleRoleChange(user.id, val)}
                    disabled={isSaving || isDeleting}
                  >
                    <SelectTrigger className="h-8 w-[140px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="owner">
                        <div className="flex items-center gap-2">
                          <Badge variant="default" className="text-[10px] px-1 py-0">
                            Owner
                          </Badge>
                          <span className="text-xs text-gray-500">Accesso admin completo</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="admin">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px] px-1 py-0">
                            Admin
                          </Badge>
                          <span className="text-xs text-gray-500">Accesso admin completo</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="user">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            Utente
                          </Badge>
                          <span className="text-xs text-gray-500">Nessun accesso admin</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>

                {/* Save button */}
                <TableCell>
                  {isDirty && (
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
                    (isConfirming ? (
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-8 text-xs px-2"
                          onClick={() => handleDeleteConfirm(user.id)}
                          disabled={isDeleting}
                        >
                          Conferma
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs px-2"
                          onClick={() => setConfirmDelete(null)}
                        >
                          Annulla
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50"
                        onClick={() => setConfirmDelete(user.id)}
                        disabled={isDeleting}
                        title="Elimina utente"
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
              <TableCell colSpan={5} className="py-12 text-center text-sm text-gray-400">
                Nessun utente trovato.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { updatePlatformUserRole, type PlatformUser } from "@/actions/platform-users";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Save } from "lucide-react";

function initials(name: string | null, email: string | null): string {
  const src = name ?? email ?? "?";
  return src.slice(0, 2).toUpperCase();
}

interface Props {
  users: PlatformUser[];
  currentUserId: string;
}

export function PlatformUsersClient({ users, currentUserId }: Props) {
  const [roles, setRoles] = useState<Record<string, string>>(
    () => Object.fromEntries(users.map((u) => [u.id, u.role])),
  );
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState<string | null>(null);

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
        // Restore original role on error
        const original = users.find((u) => u.id === userId)?.role;
        if (original) setRoles((prev) => ({ ...prev, [userId]: original }));
      } finally {
        setSaving(null);
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
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => {
            const currentRole = roles[user.id] ?? user.role;
            const originalRole = user.role;
            const isDirty = currentRole !== originalRole;
            const isSelf = user.id === currentUserId;
            const isSaving = saving === user.id && isPending;

            return (
              <TableRow key={user.id}>
                {/* User info */}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={user.image ?? undefined} />
                      <AvatarFallback className="text-xs bg-gray-100">
                        {initials(user.name, user.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {user.name ?? <span className="text-gray-400 italic">Nessun nome</span>}
                        {isSelf && (
                          <span className="ml-1.5 text-xs font-normal text-gray-400">(tu)</span>
                        )}
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
                    {!user.hasPassword && !user.hasGoogle && (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </div>
                </TableCell>

                {/* Role selector */}
                <TableCell>
                  <Select
                    value={currentRole}
                    onValueChange={(val) => handleRoleChange(user.id, val)}
                    disabled={isSaving}
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
                      disabled={isSaving}
                    >
                      <Save className="h-3.5 w-3.5" />
                      {isSaving ? "…" : "Salva"}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}

          {users.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="py-12 text-center text-sm text-gray-400">
                Nessun utente trovato.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

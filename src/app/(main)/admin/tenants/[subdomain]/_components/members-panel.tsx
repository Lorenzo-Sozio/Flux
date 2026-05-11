"use client";

import { useState } from "react";
import {
  addTenantMember,
  removeTenantMember,
  updateTenantMemberRole,
} from "@/actions/tenants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Trash2, UserPlus } from "lucide-react";
import { format } from "date-fns";

type Member = {
  memberId: string;
  userId: string;
  role: string;
  createdAt: Date;
  name: string | null;
  email: string | null;
};

const ROLES = ["owner", "admin", "editor", "viewer"] as const;
const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

interface Props {
  subdomain: string;
  initialMembers: Member[];
}

export function MembersPanel({ subdomain, initialMembers }: Props) {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      await addTenantMember(subdomain, email, role);
      setEmail("");
      // Refresh members list
      const { listTenantMembers } = await import("@/actions/tenants");
      setMembers(await listTenantMembers(subdomain));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setError(null);
    try {
      await removeTenantMember(subdomain, userId);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    setError(null);
    try {
      await updateTenantMemberRole(subdomain, userId, newRole);
      setMembers((prev) =>
        prev.map((m) => (m.userId === userId ? { ...m, role: newRole } : m)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    }
  };

  return (
    <div className="space-y-6">
      {/* Add member form */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-semibold text-gray-900">Add Member</h2>
        <form onSubmit={handleAdd} className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="w-36 space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={adding}>
            <UserPlus className="mr-1.5 h-4 w-4" />
            {adding ? "Adding…" : "Add"}
          </Button>
        </form>
        {error && (
          <Alert variant="destructive" className="mt-3">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      {/* Members table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="font-semibold text-gray-900">
            Members ({members.length})
          </h2>
        </div>
        {members.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-400">
            No members yet. Add the first one above.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {members.map((m) => (
              <li key={m.memberId} className="flex items-center gap-4 px-6 py-4">
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-sm text-gray-900">
                    {m.name ?? "—"}
                  </p>
                  <p className="truncate text-xs text-gray-500">{m.email}</p>
                </div>
                <Select
                  value={m.role}
                  onValueChange={(v) => handleRoleChange(m.userId, v)}
                >
                  <SelectTrigger className="w-28 h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r} className="text-xs">
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-gray-400 w-20 shrink-0 text-right">
                  {format(new Date(m.createdAt), "MMM d, yyyy")}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
                  onClick={() => handleRemove(m.userId)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

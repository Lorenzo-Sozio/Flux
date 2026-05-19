"use client";

import { useState } from "react";

import { format } from "date-fns";
import { AlertCircle, Check, Clock, Copy, Mail, RotateCcw, Trash2, UserPlus, X } from "lucide-react";

import {
  inviteTenantMember,
  listTenantMembers,
  listTenantPendingInvitations,
  removeTenantMember,
  resendTenantInvitation,
  revokeTenantInvitation,
  updateTenantMemberRole,
} from "@/actions/tenants";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Member = {
  memberId: string;
  userId: string;
  role: string;
  createdAt: Date;
  name: string | null;
  email: string | null;
};

type PendingInvitation = {
  id: string;
  email: string;
  tenantRole: string | null;
  expiresAt: Date;
  createdAt: Date;
};

const ROLES = ["owner", "admin", "editor", "viewer"] as const;
const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

const ROLE_BADGE_VARIANT: Record<string, "default" | "secondary" | "outline"> = {
  owner: "default",
  admin: "secondary",
  editor: "outline",
  viewer: "outline",
};

interface Props {
  subdomain: string;
  initialMembers: Member[];
  initialInvitations: PendingInvitation[];
}

export function MembersPanel({ subdomain, initialMembers, initialInvitations }: Props) {
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [invitations, setInvitations] = useState<PendingInvitation[]>(initialInvitations);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "added" | "invited";
    emailSent?: boolean;
    inviteUrl?: string;
  } | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refreshLists = async () => {
    const [updatedMembers, updatedInvitations] = await Promise.all([
      listTenantMembers(subdomain),
      listTenantPendingInvitations(subdomain),
    ]);
    setMembers(updatedMembers);
    setInvitations(updatedInvitations);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setError(null);
    setFeedback(null);
    try {
      const result = await inviteTenantMember(subdomain, email, role);
      setEmail("");
      if ("added" in result) {
        setFeedback({ type: "added" });
        const updatedMembers = await listTenantMembers(subdomain);
        setMembers(updatedMembers);
      } else {
        setFeedback({ type: "invited", emailSent: result.emailSent, inviteUrl: result.inviteUrl });
        const updatedInvitations = await listTenantPendingInvitations(subdomain);
        setInvitations(updatedInvitations);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (userId: string) => {
    setError(null);
    setFeedback(null);
    try {
      await removeTenantMember(subdomain, userId);
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    setError(null);
    setFeedback(null);
    try {
      await updateTenantMemberRole(subdomain, userId, newRole);
      setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, role: newRole } : m)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role");
    }
  };

  const handleRevoke = async (invitationId: string) => {
    setRevokingId(invitationId);
    setError(null);
    try {
      await revokeTenantInvitation(subdomain, invitationId);
      setInvitations((prev) => prev.filter((i) => i.id !== invitationId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke invitation");
    } finally {
      setRevokingId(null);
    }
  };

  const handleResend = async (invitationId: string) => {
    setResendingId(invitationId);
    setError(null);
    try {
      const result = await resendTenantInvitation(subdomain, invitationId);
      await refreshLists();
      setFeedback({ type: "invited", emailSent: result.emailSent, inviteUrl: result.inviteUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend invitation");
    } finally {
      setResendingId(null);
    }
  };

  const handleCopy = async (url: string, id: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Add / invite form */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 font-semibold text-gray-900">Add or Invite Member</h2>
        <p className="mb-4 text-xs text-gray-500">
          Existing users are added immediately. New emails receive an invitation link.
        </p>
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
            {adding ? "Processing…" : "Add / Invite"}
          </Button>
        </form>

        {error && (
          <Alert variant="destructive" className="mt-3">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {feedback?.type === "added" && (
          <Alert className="mt-3 border-green-200 bg-green-50 text-green-800">
            <Check className="h-4 w-4" />
            <AlertDescription>User added successfully.</AlertDescription>
          </Alert>
        )}

        {feedback?.type === "invited" && (
          <Alert className="mt-3 border-blue-200 bg-blue-50 text-blue-800">
            <Mail className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <div className="flex items-center gap-3">
                <span>
                  {feedback.emailSent
                    ? "Invitation email sent. The user will be added to this tenant upon registration."
                    : "Invitation created but email delivery failed. Share the link below manually."}
                </span>
              </div>
              {feedback.inviteUrl && (
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded bg-blue-100 px-2 py-1 font-mono text-xs">
                    {feedback.inviteUrl}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 shrink-0 gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-100"
                    onClick={() => handleCopy(feedback.inviteUrl!, "feedback")}
                  >
                    {copiedId === "feedback" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copiedId === "feedback" ? "Copied" : "Copy"}
                  </Button>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Members table */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="font-semibold text-gray-900">Members ({members.length})</h2>
        </div>
        {members.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-gray-400">No members yet. Add the first one above.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {members.map((m) => (
              <li key={m.memberId} className="flex items-center gap-4 px-6 py-4">
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-sm text-gray-900">{m.name ?? "—"}</p>
                  <p className="truncate text-xs text-gray-500">{m.email}</p>
                </div>
                <Select value={m.role} onValueChange={(v) => handleRoleChange(m.userId, v)}>
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

      {/* Pending invitations */}
      {invitations.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-6 py-4">
            <h2 className="font-semibold text-gray-900">Pending Invitations ({invitations.length})</h2>
          </div>
          <ul className="divide-y divide-gray-100">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex items-center gap-4 px-6 py-4">
                <Clock className="h-4 w-4 shrink-0 text-amber-400" />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{inv.email}</p>
                  <p className="text-xs text-gray-400">Expires {format(new Date(inv.expiresAt), "MMM d, yyyy")}</p>
                </div>
                <Badge variant={ROLE_BADGE_VARIANT[inv.tenantRole ?? "editor"] ?? "outline"} className="text-xs">
                  {ROLE_LABELS[inv.tenantRole ?? "editor"] ?? inv.tenantRole}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs text-gray-600 hover:text-gray-900"
                  disabled={resendingId === inv.id}
                  onClick={() => handleResend(inv.id)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {resendingId === inv.id ? "Sending…" : "Resend"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                  disabled={revokingId === inv.id}
                  onClick={() => handleRevoke(inv.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

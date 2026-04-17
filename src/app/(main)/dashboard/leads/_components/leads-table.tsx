"use client";

import { useState, useTransition } from "react";

import Link from "next/link";

import { toast } from "sonner";

import { bulkAssignLeads, bulkDeleteLeads, bulkUpdateLeadStatus } from "@/actions/bulk";
import { BulkActionBar } from "@/components/crm/bulk-action-bar";
import { LeadScoreBadge } from "@/components/crm/lead-score-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { LeadActions } from "./lead-modal";

const RATING_COLORS: Record<string, string> = {
  hot: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  warm: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  cold: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

const LEAD_STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "contacting", label: "Contacting" },
  { value: "engaged", label: "Engaged" },
  { value: "qualified", label: "Qualified" },
  { value: "unqualified", label: "Unqualified" },
];

interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  companyName: string | null;
  city: string | null;
  status: string;
  rating: string | null;
  leadScore: number | null;
  ownerName: string | null;
}

interface User {
  id: string;
  name: string | null;
  email: string | null;
}

interface Props {
  leads: Lead[];
  users: User[];
  canEdit: boolean;
  activeCount: number;
}

export function LeadsTable({ leads, users, canEdit, activeCount }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const allIds = leads.map((l) => l.id);
  const allSelected = leads.length > 0 && selected.size === leads.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function handleDelete() {
    const ids = Array.from(selected);
    startTransition(async () => {
      try {
        await bulkDeleteLeads(ids);
        toast.success(`${ids.length} lead${ids.length !== 1 ? "s" : ""} deleted`);
        clearSelection();
      } catch {
        toast.error("Failed to delete leads");
      }
    });
  }

  async function handleStatusChange(status: string) {
    const ids = Array.from(selected);
    startTransition(async () => {
      try {
        await bulkUpdateLeadStatus(ids, status);
        toast.success(`${ids.length} lead${ids.length !== 1 ? "s" : ""} updated`);
        clearSelection();
      } catch {
        toast.error("Failed to update leads");
      }
    });
  }

  async function handleAssign(userId: string) {
    const ids = Array.from(selected);
    startTransition(async () => {
      try {
        await bulkAssignLeads(ids, userId);
        toast.success(`${ids.length} lead${ids.length !== 1 ? "s" : ""} assigned`);
        clearSelection();
      } catch {
        toast.error("Failed to assign leads");
      }
    });
  }

  return (
    <div className="space-y-3">
      {/* Bulk toolbar */}
      {canEdit && selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          statusOptions={LEAD_STATUS_OPTIONS}
          users={users}
          onClear={clearSelection}
          onDelete={handleDelete}
          onStatusChange={handleStatusChange}
          onAssign={handleAssign}
        />
      )}

      <Table>
        <TableHeader>
          <TableRow>
            {canEdit && (
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
            )}
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>City</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Rating</TableHead>
            <TableHead>Score</TableHead>
            <TableHead>Assigned To</TableHead>
            {canEdit && <TableHead className="w-[100px] text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => (
            <TableRow
              key={lead.id}
              className={`hover:bg-muted/40 ${selected.has(lead.id) ? "bg-primary/5" : ""}`}
            >
              {canEdit && (
                <TableCell>
                  <Checkbox
                    checked={selected.has(lead.id)}
                    onCheckedChange={() => toggle(lead.id)}
                    aria-label={`Select ${lead.firstName} ${lead.lastName}`}
                  />
                </TableCell>
              )}
              <TableCell>
                <Link href={`/dashboard/leads/${lead.id}`} className="font-medium hover:underline">
                  {lead.firstName} {lead.lastName}
                </Link>
              </TableCell>
              <TableCell>{lead.email}</TableCell>
              <TableCell>{lead.companyName}</TableCell>
              <TableCell>{lead.city}</TableCell>
              <TableCell className="capitalize">{lead.status}</TableCell>
              <TableCell>
                {lead.rating && (
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded capitalize ${RATING_COLORS[lead.rating] ?? ""}`}>
                    {lead.rating}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <LeadScoreBadge score={lead.leadScore} />
              </TableCell>
              <TableCell>
                {lead.ownerName ? (
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                      {lead.ownerName.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-sm">{lead.ownerName}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              {canEdit && (
                <TableCell className="text-right">
                  <LeadActions lead={lead} />
                </TableCell>
              )}
            </TableRow>
          ))}
          {leads.length === 0 && (
            <TableRow>
              <TableCell colSpan={canEdit ? 10 : 9} className="text-center py-10 text-muted-foreground">
                {activeCount > 0 ? "No leads match the current filters." : "No leads yet."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

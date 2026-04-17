"use client";

import { useState, useTransition } from "react";

import Link from "next/link";

import { toast } from "sonner";

import { bulkAssignContacts, bulkDeleteContacts, bulkUpdateContactStatus } from "@/actions/bulk";
import { BulkActionBar } from "@/components/crm/bulk-action-bar";
import { LeadScoreBadge } from "@/components/crm/lead-score-badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { ContactActions } from "./contact-modal";

const CONTACT_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  jobTitle: string | null;
  city: string | null;
  status: string;
  leadScore: number | null;
  ownerName: string | null;
}

interface User {
  id: string;
  name: string | null;
  email: string | null;
}

interface Props {
  contacts: Contact[];
  users: User[];
  canEdit: boolean;
  activeCount: number;
}

export function ContactsTable({ contacts, users, canEdit, activeCount }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const allIds = contacts.map((c) => c.id);
  const allSelected = contacts.length > 0 && selected.size === contacts.length;

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
        await bulkDeleteContacts(ids);
        toast.success(`${ids.length} contact${ids.length !== 1 ? "s" : ""} deleted`);
        clearSelection();
      } catch {
        toast.error("Failed to delete contacts");
      }
    });
  }

  async function handleStatusChange(status: string) {
    const ids = Array.from(selected);
    startTransition(async () => {
      try {
        await bulkUpdateContactStatus(ids, status);
        toast.success(`${ids.length} contact${ids.length !== 1 ? "s" : ""} updated`);
        clearSelection();
      } catch {
        toast.error("Failed to update contacts");
      }
    });
  }

  async function handleAssign(userId: string) {
    const ids = Array.from(selected);
    startTransition(async () => {
      try {
        await bulkAssignContacts(ids, userId);
        toast.success(`${ids.length} contact${ids.length !== 1 ? "s" : ""} assigned`);
        clearSelection();
      } catch {
        toast.error("Failed to assign contacts");
      }
    });
  }

  return (
    <div className="space-y-3">
      {/* Bulk toolbar */}
      {canEdit && selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          statusOptions={CONTACT_STATUS_OPTIONS}
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
            <TableHead>Job Title</TableHead>
            <TableHead>City</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Score</TableHead>
            <TableHead>Assigned To</TableHead>
            {canEdit && <TableHead className="w-[100px] text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact) => (
            <TableRow
              key={contact.id}
              className={`hover:bg-muted/40 ${selected.has(contact.id) ? "bg-primary/5" : ""}`}
            >
              {canEdit && (
                <TableCell>
                  <Checkbox
                    checked={selected.has(contact.id)}
                    onCheckedChange={() => toggle(contact.id)}
                    aria-label={`Select ${contact.firstName} ${contact.lastName}`}
                  />
                </TableCell>
              )}
              <TableCell>
                <Link href={`/dashboard/contacts/${contact.id}`} className="font-medium hover:underline">
                  {contact.firstName} {contact.lastName}
                </Link>
              </TableCell>
              <TableCell>{contact.email}</TableCell>
              <TableCell>{contact.jobTitle}</TableCell>
              <TableCell>{contact.city}</TableCell>
              <TableCell className="capitalize">{contact.status}</TableCell>
              <TableCell>
                <LeadScoreBadge score={contact.leadScore} />
              </TableCell>
              <TableCell>
                {contact.ownerName ? (
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                      {contact.ownerName.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-sm">{contact.ownerName}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              {canEdit && (
                <TableCell className="text-right">
                  <ContactActions contact={contact} />
                </TableCell>
              )}
            </TableRow>
          ))}
          {contacts.length === 0 && (
            <TableRow>
              <TableCell colSpan={canEdit ? 9 : 8} className="text-center py-10 text-muted-foreground">
                {activeCount > 0 ? "No contacts match the current filters." : "No contacts yet."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

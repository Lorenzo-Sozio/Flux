"use client";

import { useState, useTransition } from "react";

import Link from "next/link";

import { UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { bulkAssignContacts, bulkDeleteContacts, bulkUpdateContactStatus } from "@/actions/bulk";
import { BulkActionBar } from "@/components/crm/bulk-action-bar";
import { EmptyState } from "@/components/crm/empty-state";
import { LeadScoreBadge } from "@/components/crm/lead-score-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { ContactActions, ContactModal } from "./contact-modal";

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
  const t = useTranslations("contacts");
  const te = useTranslations("emptyStates");
  const tc = useTranslations("common");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const contactStatusOptions = [
    { value: "active", label: t("statuses.active") },
    { value: "inactive", label: t("statuses.inactive") },
  ];

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
        toast.success(t("bulk.deleted", { count: ids.length }));
        clearSelection();
      } catch {
        toast.error(t("bulk.deleteFailed"));
      }
    });
  }

  async function handleStatusChange(status: string) {
    const ids = Array.from(selected);
    startTransition(async () => {
      try {
        await bulkUpdateContactStatus(ids, status);
        toast.success(t("bulk.updated", { count: ids.length }));
        clearSelection();
      } catch {
        toast.error(t("bulk.updateFailed"));
      }
    });
  }

  async function handleAssign(userId: string) {
    const ids = Array.from(selected);
    startTransition(async () => {
      try {
        await bulkAssignContacts(ids, userId);
        toast.success(t("bulk.assigned", { count: ids.length }));
        clearSelection();
      } catch {
        toast.error(t("bulk.assignFailed"));
      }
    });
  }

  return (
    <div className="space-y-3">
      {canEdit && selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          statusOptions={contactStatusOptions}
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
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
              </TableHead>
            )}
            <TableHead>{t("columns.name")}</TableHead>
            <TableHead>{tc("email")}</TableHead>
            <TableHead>{t("jobTitle")}</TableHead>
            <TableHead>{tc("address")}</TableHead>
            <TableHead>{tc("status")}</TableHead>
            <TableHead>{t("columns.score")}</TableHead>
            <TableHead>{t("columns.assignedTo")}</TableHead>
            {canEdit && <TableHead className="w-[100px] text-right">{t("columns.actions")}</TableHead>}
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
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-[10px] text-primary">
                      {contact.ownerName.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-sm">{contact.ownerName}</span>
                  </div>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
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
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={canEdit ? 9 : 8} className="p-0">
                {activeCount > 0 ? (
                  <EmptyState icon={UsersIcon} title={te("filteredTitle")} description={te("filteredDescription")} />
                ) : (
                  <EmptyState
                    icon={UsersIcon}
                    title={te("contacts.title")}
                    description={te("contacts.description")}
                    action={
                      canEdit ? (
                        <ContactModal>
                          <Button size="sm">{t("newContact")}</Button>
                        </ContactModal>
                      ) : undefined
                    }
                  />
                )}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

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
import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
import { Badge } from "@/components/ui/badge";
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
  /** Filtered or searched. A narrowed list that finds nothing is not an empty
   * workspace, and must not be offered a create button for a record the person
   * was not looking to create. */
  narrowed: boolean;
}

export function ContactsTable({ contacts, users, canEdit, narrowed }: Props) {
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

  const emptyState = narrowed ? (
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
  );

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

      {contacts.length === 0 ? (
        emptyState
      ) : (
        <ResponsiveRecordList
          cards={
            <RecordCards
              items={contacts.map((contact) => ({
                id: contact.id,
                href: `/dashboard/contacts/${contact.id}`,
                title: `${contact.firstName} ${contact.lastName}`,
                subtitle: contact.email,
                // Status is a badge, not a field. As a labelled row it spent a
                // third of every card saying "Active", which is what almost
                // every contact is; beside the name it is read at a glance and
                // costs nothing. The score joins it there when there is one.
                badge: (
                  <div className="flex items-center gap-1.5">
                    <LeadScoreBadge score={contact.leadScore} />
                    <Badge variant="outline" className="h-5 shrink-0 text-[10px] capitalize">
                      {contact.status}
                    </Badge>
                  </div>
                ),
                fields: [
                  { label: t("jobTitle"), value: contact.jobTitle },
                  { label: tc("address"), value: contact.city },
                  { label: t("columns.assignedTo"), value: contact.ownerName },
                ],
                // The card is already a link to this record, so the eye would be
                // a third of the row spent on a duplicate.
                actions: canEdit ? <ContactActions contact={contact} hideView /> : undefined,
                selected: selected.has(contact.id),
                onToggle: canEdit ? () => toggle(contact.id) : undefined,
                selectLabel: `${contact.firstName} ${contact.lastName}`,
              }))}
            />
          }
          table={
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
              </TableBody>
            </Table>
          }
        />
      )}
    </div>
  );
}

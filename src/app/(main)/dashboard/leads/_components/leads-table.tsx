"use client";

import { useState, useTransition } from "react";

import Link from "next/link";

import { TargetIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { bulkAssignLeads, bulkDeleteLeads, bulkUpdateLeadStatus } from "@/actions/bulk";
import { BulkActionBar } from "@/components/crm/bulk-action-bar";
import { EmptyState } from "@/components/crm/empty-state";
import { LeadScoreBadge } from "@/components/crm/lead-score-badge";
import { RecordCards, ResponsiveRecordList } from "@/components/crm/record-cards";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { LeadActions, LeadModal } from "./lead-modal";

const RATING_COLORS: Record<string, string> = {
  hot: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  warm: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  cold: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

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

interface LookupItem {
  id: string;
  name: string;
}

interface Props {
  leads: Lead[];
  users: User[];
  canEdit: boolean;
  /** Filtered or searched. A narrowed list that finds nothing is not an empty
   * workspace, and must not be offered a create button for a record the person
   * was not looking to create. */
  narrowed: boolean;
  categories?: LookupItem[];
  companyTypes?: LookupItem[];
}

export function LeadsTable({ leads, users, canEdit, narrowed, categories = [], companyTypes = [] }: Props) {
  const t = useTranslations("leads");
  const te = useTranslations("emptyStates");
  const tc = useTranslations("common");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const leadStatusOptions = [
    { value: "new", label: t("statuses.new") },
    { value: "contacting", label: t("statuses.contacting") },
    { value: "engaged", label: t("statuses.engaged") },
    { value: "qualified", label: t("statuses.qualified") },
    { value: "unqualified", label: t("statuses.unqualified") },
  ];

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
        await bulkUpdateLeadStatus(ids, status);
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
        await bulkAssignLeads(ids, userId);
        toast.success(t("bulk.assigned", { count: ids.length }));
        clearSelection();
      } catch {
        toast.error(t("bulk.assignFailed"));
      }
    });
  }

  const emptyState = narrowed ? (
    <EmptyState icon={TargetIcon} title={te("filteredTitle")} description={te("filteredDescription")} />
  ) : (
    <EmptyState
      icon={TargetIcon}
      title={te("leads.title")}
      description={te("leads.description")}
      action={
        canEdit ? (
          <LeadModal categories={categories} companyTypes={companyTypes}>
            <Button size="sm">{t("newLead")}</Button>
          </LeadModal>
        ) : undefined
      }
    />
  );

  return (
    <div className="space-y-3">
      {canEdit && selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          statusOptions={leadStatusOptions}
          users={users}
          onClear={clearSelection}
          onDelete={handleDelete}
          onStatusChange={handleStatusChange}
          onAssign={handleAssign}
        />
      )}

      {leads.length === 0 ? (
        emptyState
      ) : (
        <ResponsiveRecordList
          cards={
            <RecordCards
              items={leads.map((lead) => ({
                id: lead.id,
                href: `/dashboard/leads/${lead.id}`,
                title: `${lead.firstName} ${lead.lastName}`,
                subtitle: lead.companyName ?? lead.email,
                badge: lead.rating ? (
                  <span
                    className={`rounded px-1.5 py-0.5 font-medium text-xs capitalize ${RATING_COLORS[lead.rating] ?? ""}`}
                  >
                    {t(`ratings.${lead.rating as "hot" | "warm" | "cold"}`)}
                  </span>
                ) : undefined,
                fields: [
                  { label: tc("email"), value: lead.email },
                  { label: t("columns.city"), value: lead.city },
                  { label: t("columns.assignedTo"), value: lead.ownerName },
                ],
                actions: canEdit ? (
                  <LeadActions lead={lead} categories={categories} companyTypes={companyTypes} hideView />
                ) : undefined,
                selected: selected.has(lead.id),
                onToggle: canEdit ? () => toggle(lead.id) : undefined,
                selectLabel: `${lead.firstName} ${lead.lastName}`,
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
                  <TableHead>{tc("company")}</TableHead>
                  <TableHead>{t("columns.city")}</TableHead>
                  <TableHead>{tc("status")}</TableHead>
                  <TableHead>{t("columns.rating")}</TableHead>
                  <TableHead>{t("columns.score")}</TableHead>
                  <TableHead>{t("columns.assignedTo")}</TableHead>
                  {canEdit && <TableHead className="w-[100px] text-right">{t("columns.actions")}</TableHead>}
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
                        <span
                          className={`rounded px-1.5 py-0.5 font-medium text-xs capitalize ${RATING_COLORS[lead.rating] ?? ""}`}
                        >
                          {t(`ratings.${lead.rating as "hot" | "warm" | "cold"}`)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <LeadScoreBadge score={lead.leadScore} />
                    </TableCell>
                    <TableCell>
                      {lead.ownerName ? (
                        <div className="flex items-center gap-1.5">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-[10px] text-primary">
                            {lead.ownerName.charAt(0).toUpperCase()}
                          </span>
                          <span className="text-sm">{lead.ownerName}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    {canEdit && (
                      <TableCell className="text-right">
                        <LeadActions lead={lead} categories={categories} companyTypes={companyTypes} />
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

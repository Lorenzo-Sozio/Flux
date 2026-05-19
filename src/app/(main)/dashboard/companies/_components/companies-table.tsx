"use client";

import { useState, useTransition } from "react";

import Link from "next/link";

import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { bulkAssignCompanies, bulkDeleteCompanies, bulkUpdateCompanyStatus } from "@/actions/bulk";
import { BulkActionBar } from "@/components/crm/bulk-action-bar";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { CompanyActions } from "./company-modal";

const TYPE_COLORS: Record<string, string> = {
  customer: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  prospect: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  partner: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  vendor: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

interface Company {
  id: string;
  name: string;
  industry: string | null;
  city: string | null;
  type: string | null;
  status: string;
  employeeCount: number | null;
  website: string | null;
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
  companies: Company[];
  users: User[];
  canEdit: boolean;
  activeCount: number;
  categories?: LookupItem[];
  companyTypes?: LookupItem[];
}

export function CompaniesTable({ companies, users, canEdit, activeCount, categories = [], companyTypes = [] }: Props) {
  const t = useTranslations("companies");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const companyStatusOptions = [
    { value: "active", label: t("statuses.active") },
    { value: "inactive", label: t("statuses.inactive") },
  ];

  const allIds = companies.map((c) => c.id);
  const allSelected = companies.length > 0 && selected.size === companies.length;

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
        await bulkDeleteCompanies(ids);
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
        await bulkUpdateCompanyStatus(ids, status);
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
        await bulkAssignCompanies(ids, userId);
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
          statusOptions={companyStatusOptions}
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
            <TableHead>{t("columns.industry")}</TableHead>
            <TableHead>{t("columns.city")}</TableHead>
            <TableHead>{t("columns.type")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead>{t("columns.employees")}</TableHead>
            <TableHead>{t("columns.assignedTo")}</TableHead>
            {canEdit && <TableHead className="w-[100px] text-right">{t("columns.actions")}</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.map((company) => (
            <TableRow
              key={company.id}
              className={`hover:bg-muted/40 ${selected.has(company.id) ? "bg-primary/5" : ""}`}
            >
              {canEdit && (
                <TableCell>
                  <Checkbox
                    checked={selected.has(company.id)}
                    onCheckedChange={() => toggle(company.id)}
                    aria-label={`Select ${company.name}`}
                  />
                </TableCell>
              )}
              <TableCell>
                <Link href={`/dashboard/companies/${company.id}`} className="font-medium hover:underline">
                  {company.name}
                </Link>
                {company.website && (
                  <p className="text-xs text-muted-foreground truncate max-w-[180px]">{company.website}</p>
                )}
              </TableCell>
              <TableCell>{company.industry}</TableCell>
              <TableCell>{company.city}</TableCell>
              <TableCell>
                {company.type && (
                  <span
                    className={`text-xs font-medium px-1.5 py-0.5 rounded capitalize ${TYPE_COLORS[company.type] ?? ""}`}
                  >
                    {t(`types.${company.type as "customer" | "prospect" | "partner" | "vendor"}`)}
                  </span>
                )}
              </TableCell>
              <TableCell className="capitalize">{company.status}</TableCell>
              <TableCell>{company.employeeCount}</TableCell>
              <TableCell>
                {company.ownerName ? (
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                      {company.ownerName.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-sm">{company.ownerName}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              {canEdit && (
                <TableCell className="text-right">
                  <CompanyActions company={company} categories={categories} companyTypes={companyTypes} />
                </TableCell>
              )}
            </TableRow>
          ))}
          {companies.length === 0 && (
            <TableRow>
              <TableCell colSpan={canEdit ? 9 : 8} className="text-center py-10 text-muted-foreground">
                {activeCount > 0 ? t("noCompaniesFiltered") : t("noCompaniesYet")}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";

import Link from "next/link";

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

const COMPANY_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

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

interface Props {
  companies: Company[];
  users: User[];
  canEdit: boolean;
  activeCount: number;
}

export function CompaniesTable({ companies, users, canEdit, activeCount }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

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
        toast.success(`${ids.length} compan${ids.length !== 1 ? "ies" : "y"} deleted`);
        clearSelection();
      } catch {
        toast.error("Failed to delete companies");
      }
    });
  }

  async function handleStatusChange(status: string) {
    const ids = Array.from(selected);
    startTransition(async () => {
      try {
        await bulkUpdateCompanyStatus(ids, status);
        toast.success(`${ids.length} compan${ids.length !== 1 ? "ies" : "y"} updated`);
        clearSelection();
      } catch {
        toast.error("Failed to update companies");
      }
    });
  }

  async function handleAssign(userId: string) {
    const ids = Array.from(selected);
    startTransition(async () => {
      try {
        await bulkAssignCompanies(ids, userId);
        toast.success(`${ids.length} compan${ids.length !== 1 ? "ies" : "y"} assigned`);
        clearSelection();
      } catch {
        toast.error("Failed to assign companies");
      }
    });
  }

  return (
    <div className="space-y-3">
      {canEdit && selected.size > 0 && (
        <BulkActionBar
          count={selected.size}
          statusOptions={COMPANY_STATUS_OPTIONS}
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
            <TableHead>Name</TableHead>
            <TableHead>Industry</TableHead>
            <TableHead>City</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Employees</TableHead>
            <TableHead>Assigned To</TableHead>
            {canEdit && <TableHead className="w-[100px] text-right">Actions</TableHead>}
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
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded capitalize ${TYPE_COLORS[company.type] ?? ""}`}>
                    {company.type}
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
                  <CompanyActions company={company} />
                </TableCell>
              )}
            </TableRow>
          ))}
          {companies.length === 0 && (
            <TableRow>
              <TableCell colSpan={canEdit ? 9 : 8} className="text-center py-10 text-muted-foreground">
                {activeCount > 0 ? "No companies match the current filters." : "No companies yet."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

import { getCompanies } from "@/actions/crm";
import { getCustomFilters } from "@/actions/filters";
import { getCustomFieldDefinitions } from "@/actions/custom-fields";
import { toFieldMetaMap, COMPANY_FIELDS, customFieldsToMetaMap } from "@/lib/filter-engine";
import { decodeFilter, countActive } from "@/lib/filter-types";
import { FilterBuilder } from "@/components/crm/filter-builder";
import { ImportExportButtons } from "@/components/crm/import-export-buttons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { CompanyActions, CompanyModal } from "./_components/company-modal";
import { auth } from "@/auth";

const TYPE_COLORS: Record<string, string> = {
  customer: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  prospect: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  partner:  "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  vendor:   "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
};

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const encoded = params.filter ?? null;

  const session = await auth();
  const canEdit = session?.user?.role !== "viewer";

  const [allCompanies, savedFilters, customDefs] = await Promise.all([
    getCompanies(encoded),
    getCustomFilters("companies").catch(() => []),
    getCustomFieldDefinitions("company").catch(() => []),
  ]);

  const tree = encoded ? decodeFilter(encoded) : null;
  const activeCount = tree ? countActive(tree.conditions) : 0;
  const fields = { ...toFieldMetaMap(COMPANY_FIELDS), ...customFieldsToMetaMap(customDefs) };

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-2xl">Companies</h1>
          <Badge variant="secondary">{allCompanies.length}</Badge>
          {activeCount > 0 && (
            <Badge variant="outline" className="text-xs gap-1">
              {activeCount} filter{activeCount !== 1 ? "s" : ""} active
              <Link href="/dashboard/companies" className="ml-1 hover:text-destructive">✕</Link>
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <FilterBuilder
            entityType="companies"
            fields={fields}
            savedFilters={savedFilters.map((f) => ({
              id: f.id,
              name: f.name,
              criteria: f.criteria,
            }))}
            basePath="/dashboard/companies"
          />
          <ImportExportButtons entityType="companies" />
          {canEdit && (
            <CompanyModal>
              <Button>Add Company</Button>
            </CompanyModal>
          )}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Industry</TableHead>
            <TableHead>City</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Employees</TableHead>
            <TableHead>Assigned To</TableHead>
            <TableHead className="w-[100px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {allCompanies.map((company) => (
            <TableRow key={company.id} className="hover:bg-muted/40">
              <TableCell>
                <Link
                  href={`/dashboard/companies/${company.id}`}
                  className="font-medium hover:underline"
                >
                  {company.name}
                </Link>
                {company.website && (
                  <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                    {company.website}
                  </p>
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
              <TableCell className="text-right">
                {canEdit && <CompanyActions company={company} />}
              </TableCell>
            </TableRow>
          ))}
          {allCompanies.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
                {activeCount > 0
                  ? "No companies match the current filters."
                  : "No companies yet."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

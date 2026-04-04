import { getLeads } from "@/actions/crm";
import { getCustomFilters } from "@/actions/filters";
import { toFieldMetaMap, LEAD_FIELDS } from "@/lib/filter-engine";
import { decodeFilter, countActive } from "@/lib/filter-types";
import { FilterBuilder } from "@/components/crm/filter-builder";
import { ImportExportButtons } from "@/components/crm/import-export-buttons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { LeadActions, LeadModal } from "./_components/lead-modal";

const RATING_COLORS: Record<string, string> = {
  hot:  "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  warm: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  cold: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
};

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const encoded = params.filter ?? null;

  const [allLeads, savedFilters] = await Promise.all([
    getLeads(encoded),
    getCustomFilters("leads").catch(() => []),
  ]);

  const tree = encoded ? decodeFilter(encoded) : null;
  const activeCount = tree ? countActive(tree.conditions) : 0;
  const fields = toFieldMetaMap(LEAD_FIELDS);

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-2xl">Leads</h1>
          <Badge variant="secondary">{allLeads.length}</Badge>
          {activeCount > 0 && (
            <Badge variant="outline" className="text-xs gap-1">
              {activeCount} filter{activeCount !== 1 ? "s" : ""} active
              <Link href="/dashboard/leads" className="ml-1 hover:text-destructive">✕</Link>
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <FilterBuilder
            entityType="leads"
            fields={fields}
            savedFilters={savedFilters.map((f) => ({
              id: f.id,
              name: f.name,
              criteria: f.criteria,
            }))}
            basePath="/dashboard/leads"
          />
          <ImportExportButtons entityType="leads" />
          <LeadModal>
            <Button>Add Lead</Button>
          </LeadModal>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>City</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Rating</TableHead>
            <TableHead>Score</TableHead>
            <TableHead className="w-[100px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {allLeads.map((lead) => (
            <TableRow key={lead.id} className="hover:bg-muted/40">
              <TableCell>
                <Link
                  href={`/dashboard/leads/${lead.id}`}
                  className="font-medium hover:underline"
                >
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
                    className={`text-xs font-medium px-1.5 py-0.5 rounded capitalize ${
                      RATING_COLORS[lead.rating] ?? ""
                    }`}
                  >
                    {lead.rating}
                  </span>
                )}
              </TableCell>
              <TableCell>{lead.leadScore}</TableCell>
              <TableCell className="text-right">
                <LeadActions lead={lead} />
              </TableCell>
            </TableRow>
          ))}
          {allLeads.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                {activeCount > 0
                  ? "No leads match the current filters."
                  : "No leads yet."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

import Link from "next/link";

import { getLeads, getAllUsers } from "@/actions/crm";
import { getCustomFilters } from "@/actions/filters";
import { getCustomFieldDefinitions } from "@/actions/custom-fields";
import { toFieldMetaMap, LEAD_FIELDS, customFieldsToMetaMap } from "@/lib/filter-engine";
import { decodeFilter, countActive } from "@/lib/filter-types";
import { FilterBuilder } from "@/components/crm/filter-builder";
import { ImportExportButtons } from "@/components/crm/import-export-buttons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LeadModal } from "./_components/lead-modal";
import { LeadsTable } from "./_components/leads-table";
import { auth } from "@/auth";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const encoded = params.filter ?? null;

  const session = await auth();
  const canEdit = session?.user?.role !== "viewer";

  const [allLeads, savedFilters, customDefs, users] = await Promise.all([
    getLeads(encoded),
    getCustomFilters("leads").catch(() => []),
    getCustomFieldDefinitions("lead").catch(() => []),
    getAllUsers(),
  ]);

  const tree = encoded ? decodeFilter(encoded) : null;
  const activeCount = tree ? countActive(tree.conditions) : 0;
  const fields = { ...toFieldMetaMap(LEAD_FIELDS), ...customFieldsToMetaMap(customDefs) };

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
          {canEdit && (
            <LeadModal>
              <Button>Add Lead</Button>
            </LeadModal>
          )}
        </div>
      </div>

      <LeadsTable
        leads={allLeads}
        users={users}
        canEdit={canEdit}
        activeCount={activeCount}
      />
    </div>
  );
}

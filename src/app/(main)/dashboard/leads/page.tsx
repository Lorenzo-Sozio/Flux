import Link from "next/link";

import { getTranslations } from "next-intl/server";

import { getAllUsers, getCompanyCategories, getCompanyTypes, listLeads } from "@/actions/crm";
import { getCustomFieldDefinitions } from "@/actions/custom-fields";
import { getSavedViews } from "@/actions/filters";
import { FilterBuilder } from "@/components/crm/filter-builder";
import { ImportExportButtons } from "@/components/crm/import-export-buttons";
import { ListToolbar } from "@/components/crm/list-toolbar";
import { PinnedViews } from "@/components/crm/pinned-views";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hasCapability } from "@/lib/auth-guard";
import { customFieldsToMetaMap, LEAD_FIELDS, toFieldMetaMap } from "@/lib/filter-engine";
import { countActive, decodeFilter } from "@/lib/filter-types";
import { parseListParams } from "@/lib/pagination";

import { LeadModal } from "./_components/lead-modal";
import { LeadsTable } from "./_components/leads-table";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams;
  // The whole list state lives in the URL, so a filtered and sorted page stays
  // shareable and the back button works (audit rilievo B-08).
  const listParams = parseListParams(params);
  const encoded = listParams.filter;

  // The workspace role, not the platform staff field: the latter is "user" for
  // every customer, so this was always true and a viewer saw buttons that could
  // only fail (audit rilievo U-02).
  const [canEdit, canImport] = await Promise.all([hasCapability("record:write"), hasCapability("record:import")]);

  const [pageResult, savedFilters, customDefs, users, categories, companyTypes] = await Promise.all([
    listLeads(listParams),
    getSavedViews("leads").catch(() => []),
    getCustomFieldDefinitions("lead").catch(() => []),
    getAllUsers(),
    getCompanyCategories().catch(() => []),
    getCompanyTypes().catch(() => []),
  ]);

  const t = await getTranslations("leads");
  const tc = await getTranslations("common");
  const tree = encoded ? decodeFilter(encoded) : null;
  const activeCount = tree ? countActive(tree.conditions) : 0;
  const fields = { ...toFieldMetaMap(LEAD_FIELDS), ...customFieldsToMetaMap(customDefs) };
  // "Mine" is the first thing a list is narrowed by: the owner, by name.
  if (fields.ownerId) {
    fields.ownerId = {
      ...fields.ownerId,
      lookupOptions: users.map((u) => ({ value: u.id, label: u.name ?? u.email ?? u.id })),
    };
  }

  if (fields.leadTypeId) {
    fields.leadTypeId = {
      ...fields.leadTypeId,
      lookupOptions: companyTypes.map((t) => ({ value: t.id, label: t.name })),
    };
  }
  if (fields.leadCategoryId) {
    fields.leadCategoryId = {
      ...fields.leadCategoryId,
      lookupOptions: categories.map((c) => ({ value: c.id, label: c.name })),
    };
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-bold text-2xl">{t("title")}</h1>
          <Badge variant="secondary">{pageResult.total}</Badge>
          {activeCount > 0 && (
            <Badge variant="outline" className="gap-1 text-xs">
              {tc("filtersActive", { count: activeCount })}
              <Link href="/dashboard/leads" className="ml-1 hover:text-destructive">
                ✕
              </Link>
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <ImportExportButtons entityType="leads" canImport={canImport} />
          {canEdit && (
            <LeadModal categories={categories} companyTypes={companyTypes}>
              <Button>{t("newLead")}</Button>
            </LeadModal>
          )}
        </div>
      </div>

      <PinnedViews views={savedFilters} basePath="/dashboard/leads" />
      <div className="mb-4">
        <ListToolbar
          total={pageResult.total}
          page={pageResult.page}
          pageCount={pageResult.pageCount}
          pageSize={pageResult.pageSize}
          shown={pageResult.rows.length}
        />
      </div>

      <LeadsTable
        leads={pageResult.rows}
        users={users}
        canEdit={canEdit}
        narrowed={activeCount > 0 || listParams.search.length > 0}
        categories={categories}
        companyTypes={companyTypes}
      />
    </div>
  );
}

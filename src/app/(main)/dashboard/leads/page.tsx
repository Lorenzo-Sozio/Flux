import Link from "next/link";

import { getTranslations } from "next-intl/server";

import { getAllUsers, getCompanyCategories, getCompanyTypes, getLeads } from "@/actions/crm";
import { getCustomFieldDefinitions } from "@/actions/custom-fields";
import { getCustomFilters } from "@/actions/filters";
import { auth } from "@/auth";
import { FilterBuilder } from "@/components/crm/filter-builder";
import { ImportExportButtons } from "@/components/crm/import-export-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { customFieldsToMetaMap, LEAD_FIELDS, toFieldMetaMap } from "@/lib/filter-engine";
import { countActive, decodeFilter } from "@/lib/filter-types";

import { LeadModal } from "./_components/lead-modal";
import { LeadsTable } from "./_components/leads-table";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams;
  const encoded = params.filter ?? null;

  const session = await auth();
  const canEdit = session?.user?.role !== "viewer";

  const [allLeads, savedFilters, customDefs, users, categories, companyTypes] = await Promise.all([
    getLeads(encoded),
    getCustomFilters("leads").catch(() => []),
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
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-2xl">{t("title")}</h1>
          <Badge variant="secondary">{allLeads.length}</Badge>
          {activeCount > 0 && (
            <Badge variant="outline" className="text-xs gap-1">
              {tc("filtersActive", { count: activeCount })}
              <Link href="/dashboard/leads" className="ml-1 hover:text-destructive">
                ✕
              </Link>
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
            <LeadModal categories={categories} companyTypes={companyTypes}>
              <Button>{t("newLead")}</Button>
            </LeadModal>
          )}
        </div>
      </div>

      <LeadsTable
        leads={allLeads}
        users={users}
        canEdit={canEdit}
        activeCount={activeCount}
        categories={categories}
        companyTypes={companyTypes}
      />
    </div>
  );
}

import Link from "next/link";

import { getTranslations } from "next-intl/server";

import { getAllUsers, getCompanyCategories, getCompanyTypes, listCompanies } from "@/actions/crm";
import { getCustomFieldDefinitions } from "@/actions/custom-fields";
import { getCustomFilters } from "@/actions/filters";
import { FilterBuilder } from "@/components/crm/filter-builder";
import { ImportExportButtons } from "@/components/crm/import-export-buttons";
import { ListToolbar } from "@/components/crm/list-toolbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hasCapability } from "@/lib/auth-guard";
import { COMPANY_FIELDS, customFieldsToMetaMap, toFieldMetaMap } from "@/lib/filter-engine";
import { countActive, decodeFilter } from "@/lib/filter-types";
import { parseListParams } from "@/lib/pagination";

import { CompaniesTable } from "./_components/companies-table";
import { CompanyModal } from "./_components/company-modal";

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams;
  // The whole list state lives in the URL, so a filtered and sorted page stays
  // shareable and the back button works (audit rilievo B-08).
  const listParams = parseListParams(params);
  const encoded = listParams.filter;

  // The workspace role, not the platform staff field: the latter is "user" for
  // every customer, so this was always true and a viewer saw buttons that could
  // only fail (audit rilievo U-02).
  const canEdit = await hasCapability("record:write");

  const [pageResult, savedFilters, customDefs, users, categories, companyTypes] = await Promise.all([
    listCompanies(listParams),
    getCustomFilters("companies").catch(() => []),
    getCustomFieldDefinitions("company").catch(() => []),
    getAllUsers(),
    getCompanyCategories().catch(() => []),
    getCompanyTypes().catch(() => []),
  ]);

  const t = await getTranslations("companies");
  const tc = await getTranslations("common");
  const tree = encoded ? decodeFilter(encoded) : null;
  const activeCount = tree ? countActive(tree.conditions) : 0;
  const fields = { ...toFieldMetaMap(COMPANY_FIELDS), ...customFieldsToMetaMap(customDefs) };

  if (fields.companyCategoryId) {
    fields.companyCategoryId = {
      ...fields.companyCategoryId,
      lookupOptions: categories.map((c) => ({ value: c.id, label: c.name })),
    };
  }
  if (fields.companyTypeId) {
    fields.companyTypeId = {
      ...fields.companyTypeId,
      lookupOptions: companyTypes.map((t) => ({ value: t.id, label: t.name })),
    };
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-2xl">{t("title")}</h1>
          <Badge variant="secondary">{pageResult.total}</Badge>
          {activeCount > 0 && (
            <Badge variant="outline" className="text-xs gap-1">
              {tc("filtersActive", { count: activeCount })}
              <Link href="/dashboard/companies" className="ml-1 hover:text-destructive">
                ✕
              </Link>
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
            <CompanyModal categories={categories} companyTypes={companyTypes}>
              <Button>{t("newCompany")}</Button>
            </CompanyModal>
          )}
        </div>
      </div>

      <div className="mb-4">
        <ListToolbar
          total={pageResult.total}
          page={pageResult.page}
          pageCount={pageResult.pageCount}
          pageSize={pageResult.pageSize}
          shown={pageResult.rows.length}
        />
      </div>

      <CompaniesTable
        companies={pageResult.rows}
        users={users}
        canEdit={canEdit}
        narrowed={activeCount > 0 || listParams.search.length > 0}
        categories={categories}
        companyTypes={companyTypes}
      />
    </div>
  );
}

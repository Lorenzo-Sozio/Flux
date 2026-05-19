import Link from "next/link";

import { getTranslations } from "next-intl/server";

import { getAllUsers, getCompanies, getCompanyCategories, getCompanyTypes } from "@/actions/crm";
import { getCustomFieldDefinitions } from "@/actions/custom-fields";
import { getCustomFilters } from "@/actions/filters";
import { auth } from "@/auth";
import { FilterBuilder } from "@/components/crm/filter-builder";
import { ImportExportButtons } from "@/components/crm/import-export-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { COMPANY_FIELDS, customFieldsToMetaMap, toFieldMetaMap } from "@/lib/filter-engine";
import { countActive, decodeFilter } from "@/lib/filter-types";

import { CompaniesTable } from "./_components/companies-table";
import { CompanyModal } from "./_components/company-modal";

export default async function CompaniesPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const params = await searchParams;
  const encoded = params.filter ?? null;

  const session = await auth();
  const canEdit = session?.user?.role !== "viewer";

  const [allCompanies, savedFilters, customDefs, users, categories, companyTypes] = await Promise.all([
    getCompanies(encoded),
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
          <Badge variant="secondary">{allCompanies.length}</Badge>
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

      <CompaniesTable
        companies={allCompanies}
        users={users}
        canEdit={canEdit}
        activeCount={activeCount}
        categories={categories}
        companyTypes={companyTypes}
      />
    </div>
  );
}

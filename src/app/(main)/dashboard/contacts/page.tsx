import Link from "next/link";

import { getContacts, getAllUsers } from "@/actions/crm";
import { getCustomFilters } from "@/actions/filters";
import { getCustomFieldDefinitions } from "@/actions/custom-fields";
import { toFieldMetaMap, CONTACT_FIELDS, customFieldsToMetaMap } from "@/lib/filter-engine";
import { decodeFilter, countActive } from "@/lib/filter-types";
import { FilterBuilder } from "@/components/crm/filter-builder";
import { ImportExportButtons } from "@/components/crm/import-export-buttons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ContactModal } from "./_components/contact-modal";
import { ContactsTable } from "./_components/contacts-table";
import { auth } from "@/auth";
import { getTranslations } from "next-intl/server";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const encoded = params.filter ?? null;

  const session = await auth();
  const canEdit = session?.user?.role !== "viewer";

  const [allContacts, savedFilters, customDefs, users] = await Promise.all([
    getContacts(encoded),
    getCustomFilters("contacts").catch(() => []),
    getCustomFieldDefinitions("contact").catch(() => []),
    getAllUsers(),
  ]);

  const t = await getTranslations("contacts");
  const tc = await getTranslations("common");
  const tree = encoded ? decodeFilter(encoded) : null;
  const activeCount = tree ? countActive(tree.conditions) : 0;
  const fields = { ...toFieldMetaMap(CONTACT_FIELDS), ...customFieldsToMetaMap(customDefs) };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-2xl">{t("title")}</h1>
          <Badge variant="secondary">{allContacts.length}</Badge>
          {activeCount > 0 && (
            <Badge variant="outline" className="text-xs gap-1">
              {tc("filtersActive", { count: activeCount })}
              <Link href="/dashboard/contacts" className="ml-1 hover:text-destructive">✕</Link>
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <FilterBuilder
            entityType="contacts"
            fields={fields}
            savedFilters={savedFilters.map((f) => ({
              id: f.id,
              name: f.name,
              criteria: f.criteria,
            }))}
            basePath="/dashboard/contacts"
          />
          <ImportExportButtons entityType="contacts" />
          {canEdit && (
            <ContactModal>
              <Button>{t("newContact")}</Button>
            </ContactModal>
          )}
        </div>
      </div>

      <ContactsTable
        contacts={allContacts}
        users={users}
        canEdit={canEdit}
        activeCount={activeCount}
      />
    </div>
  );
}

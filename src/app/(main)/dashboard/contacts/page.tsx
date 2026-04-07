import { getContacts } from "@/actions/crm";
import { getCustomFilters } from "@/actions/filters";
import { getCustomFieldDefinitions } from "@/actions/custom-fields";
import { toFieldMetaMap, CONTACT_FIELDS, customFieldsToMetaMap } from "@/lib/filter-engine";
import { decodeFilter, countActive } from "@/lib/filter-types";
import { FilterBuilder } from "@/components/crm/filter-builder";
import { ImportExportButtons } from "@/components/crm/import-export-buttons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { ContactActions, ContactModal } from "./_components/contact-modal";
import { auth } from "@/auth";

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const params = await searchParams;
  const encoded = params.filter ?? null;

  const session = await auth();
  const canEdit = session?.user?.role !== "viewer";

  const [allContacts, savedFilters, customDefs] = await Promise.all([
    getContacts(encoded),
    getCustomFilters("contacts").catch(() => []),
    getCustomFieldDefinitions("contact").catch(() => []),
  ]);

  const tree = encoded ? decodeFilter(encoded) : null;
  const activeCount = tree ? countActive(tree.conditions) : 0;
  const fields = { ...toFieldMetaMap(CONTACT_FIELDS), ...customFieldsToMetaMap(customDefs) };

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-2xl">Contacts</h1>
          <Badge variant="secondary">{allContacts.length}</Badge>
          {activeCount > 0 && (
            <Badge variant="outline" className="text-xs gap-1">
              {activeCount} filter{activeCount !== 1 ? "s" : ""} active
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
              <Button>Add Contact</Button>
            </ContactModal>
          )}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Job Title</TableHead>
            <TableHead>City</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Score</TableHead>
            <TableHead>Assigned To</TableHead>
            <TableHead className="w-[100px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {allContacts.map((contact) => (
            <TableRow key={contact.id} className="hover:bg-muted/40">
              <TableCell>
                <Link
                  href={`/dashboard/contacts/${contact.id}`}
                  className="font-medium hover:underline"
                >
                  {contact.firstName} {contact.lastName}
                </Link>
              </TableCell>
              <TableCell>{contact.email}</TableCell>
              <TableCell>{contact.jobTitle}</TableCell>
              <TableCell>{contact.city}</TableCell>
              <TableCell className="capitalize">{contact.status}</TableCell>
              <TableCell>{contact.leadScore}</TableCell>
              <TableCell>
                {contact.ownerName ? (
                  <div className="flex items-center gap-1.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                      {contact.ownerName.charAt(0).toUpperCase()}
                    </span>
                    <span className="text-sm">{contact.ownerName}</span>
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                {canEdit && <ContactActions contact={contact} />}
              </TableCell>
            </TableRow>
          ))}
          {allContacts.length === 0 && (
            <TableRow>
              <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                {activeCount > 0
                  ? "No contacts match the current filters."
                  : "No contacts yet."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

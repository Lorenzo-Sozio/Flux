import { getContacts } from "@/actions/crm";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { ContactActions, ContactModal } from "./_components/contact-modal";

export default async function ContactsPage() {
  const allContacts = await getContacts();

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-bold text-2xl">Contacts</h1>
        <ContactModal>
          <Button>Add Contact</Button>
        </ContactModal>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Job Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Score</TableHead>
            <TableHead className="w-[100px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {allContacts.map((contact) => (
            <TableRow key={contact.id}>
              <TableCell>
                {contact.firstName} {contact.lastName}
              </TableCell>
              <TableCell>{contact.email}</TableCell>
              <TableCell>{contact.jobTitle}</TableCell>
              <TableCell className="capitalize">{contact.status}</TableCell>
              <TableCell>{contact.leadScore}</TableCell>
              <TableCell className="text-right">
                <ContactActions contact={contact} />
              </TableCell>
            </TableRow>
          ))}
          {allContacts.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center">
                No contacts found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

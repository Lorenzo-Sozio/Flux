import { getCompanies } from "@/actions/crm";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { CompanyActions, CompanyModal } from "./_components/company-modal";

export default async function CompaniesPage() {
  const allCompanies = await getCompanies();

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-bold text-2xl">Companies</h1>
        <CompanyModal>
          <Button>Add Company</Button>
        </CompanyModal>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Industry</TableHead>
            <TableHead>Website</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-[100px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {allCompanies.map((company) => (
            <TableRow key={company.id}>
              <TableCell className="font-medium">{company.name}</TableCell>
              <TableCell>{company.industry}</TableCell>
              <TableCell>{company.website}</TableCell>
              <TableCell className="capitalize">{company.type}</TableCell>
              <TableCell className="capitalize">{company.status}</TableCell>
              <TableCell className="text-right">
                <CompanyActions company={company} />
              </TableCell>
            </TableRow>
          ))}
          {allCompanies.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center">
                No companies found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

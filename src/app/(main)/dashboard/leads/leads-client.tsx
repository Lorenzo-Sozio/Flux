"use client";

import { useState } from "react";

import { Trash } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

import { createLead, deleteLead } from "./actions";

export function LeadsClient({ initialLeads }: { initialLeads: any[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);

    try {
      const result = await createLead(formData);
      if (result && !result.success) {
        toast.error(result.error);
      } else {
        toast.success("Lead added successfully");
        setIsOpen(false);
      }
    } catch (error) {
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (confirm("Are you sure you want to delete this lead?")) {
      try {
        await deleteLead(id);
        toast.success("Lead deleted");
      } catch (error) {
        toast.error("Error deleting lead");
      }
    }
  }

  const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    new: "default",
    contacting: "outline",
    engaged: "secondary",
    qualified: "default", // would be green in a custom variant
    unqualified: "destructive",
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Leads Management</h1>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button>+ Add Lead</Button>
          </DialogTrigger>
          <DialogContent
            className="sm:max-w-[700px] h-[80vh] flex flex-col p-0"
            aria-describedby="new-lead-description"
          >
            <DialogHeader className="px-6 py-4 border-b shrink-0">
              <DialogTitle>New Lead</DialogTitle>
              <p id="new-lead-description" className="text-sm text-muted-foreground hidden">
                Enter the details of the new lead here.
              </p>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
              <ScrollArea className="flex-1 p-6">
                <div className="grid grid-cols-2 gap-4">
                  {/* Basic Info */}
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name *</Label>
                    <Input id="firstName" name="firstName" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name *</Label>
                    <Input id="lastName" name="lastName" required />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="jobTitle">Job Title</Label>
                    <Input id="jobTitle" name="jobTitle" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" name="email" type="email" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" name="phone" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mobile">Mobile</Label>
                    <Input id="mobile" name="mobile" />
                  </div>

                  {/* Company Info */}
                  <div className="space-y-2">
                    <Label htmlFor="companyName">Company</Label>
                    <Input id="companyName" name="companyName" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="industry">Industry</Label>
                    <Input id="industry" name="industry" />
                  </div>

                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="website">Website</Label>
                    <Input id="website" name="website" type="url" placeholder="https://..." />
                  </div>

                  {/* Address */}
                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="street">Street Address</Label>
                    <Input id="street" name="street" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input id="city" name="city" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="state">State / Province</Label>
                    <Input id="state" name="state" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="zipCode">Zip / Postal Code</Label>
                    <Input id="zipCode" name="zipCode" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="country">Country</Label>
                    <Input id="country" name="country" />
                  </div>

                  {/* Tracking Info */}
                  <div className="space-y-2">
                    <Label htmlFor="status">Lead Status</Label>
                    <Select name="status" defaultValue="new">
                      <SelectTrigger aria-label="Lead Status">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">New</SelectItem>
                        <SelectItem value="contacting">Contacting</SelectItem>
                        <SelectItem value="engaged">Engaged</SelectItem>
                        <SelectItem value="qualified">Qualified</SelectItem>
                        <SelectItem value="unqualified">Unqualified</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="rating">Rating</Label>
                    <Select name="rating" defaultValue="warm">
                      <SelectTrigger aria-label="Lead Rating">
                        <SelectValue placeholder="Select rating" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="hot">Hot</SelectItem>
                        <SelectItem value="warm">Warm</SelectItem>
                        <SelectItem value="cold">Cold</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="source">Lead Source</Label>
                    <Input id="source" name="source" placeholder="e.g. Organic Search, Referral, Trade Show" />
                  </div>

                  <div className="col-span-2 space-y-2">
                    <Label htmlFor="notes">Notes</Label>
                    <Textarea id="notes" name="notes" className="min-h-[100px]" />
                  </div>
                </div>
              </ScrollArea>

              <div className="p-4 border-t bg-zinc-50 dark:bg-zinc-950 mt-auto shrink-0 flex justify-end">
                <Button type="button" variant="outline" className="mr-2" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? "Saving..." : "Save Lead"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Rating</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialLeads.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  No leads found. Create your first lead.
                </TableCell>
              </TableRow>
            ) : (
              initialLeads.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell className="font-medium">
                    {lead.firstName} {lead.lastName}
                  </TableCell>
                  <TableCell>
                    {lead.companyName || "-"}
                    {lead.jobTitle && <span className="block text-xs text-muted-foreground">{lead.jobTitle}</span>}
                  </TableCell>
                  <TableCell>{lead.email || "-"}</TableCell>
                  <TableCell>
                    <Badge variant={statusColors[lead.status] || "default"} className="capitalize">
                      {lead.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {lead.rating && (
                      <Badge variant="outline" className="capitalize">
                        {lead.rating}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => handleDelete(lead.id)}>
                      <Trash className="h-4 w-4 text-red-500" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";

import { MoreHorizontal, Search } from "lucide-react";
import { toast } from "sonner";

import { downgradeToFree, reactivateTenant, suspendTenant } from "@/actions/admin-billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface Subscription {
  subscription: {
    id: string;
    tenantId: string;
    status: string;
    billingCycle: string;
    quantity: number;
    currentPeriodEnd: Date | null;
  };
  tenant: { id: string; name: string; subdomain: string } | null;
  plan: { id: string; name: string; displayName: string } | null;
}

interface SubscriptionsTableProps {
  subscriptions: Subscription[];
  currentUserId: string;
}

const STATUS_BADGE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  trialing: "secondary",
  free: "outline",
  past_due: "destructive",
  suspended: "destructive",
  canceled: "outline",
};

export function SubscriptionsTable({ subscriptions, currentUserId }: SubscriptionsTableProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, startTransition] = useTransition();

  const filtered = subscriptions.filter((s) => {
    const matchSearch =
      !search ||
      s.tenant?.name?.toLowerCase().includes(search.toLowerCase()) ||
      s.tenant?.subdomain?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === "all" || s.subscription.status === statusFilter;
    return matchSearch && matchStatus;
  });

  async function handleAction(action: "suspend" | "reactivate" | "downgrade", tenantId: string) {
    startTransition(async () => {
      try {
        if (action === "suspend") await suspendTenant(tenantId, currentUserId);
        else if (action === "reactivate") await reactivateTenant(tenantId, currentUserId);
        else await downgradeToFree(tenantId, currentUserId);
        toast.success("Done.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Action failed");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tenants…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="trialing">Trialing</SelectItem>
            <SelectItem value="past_due">Past Due</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="free">Free</SelectItem>
            <SelectItem value="canceled">Canceled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Seats</TableHead>
              <TableHead>Cycle</TableHead>
              <TableHead>Renews</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No subscriptions found.
                </TableCell>
              </TableRow>
            )}
            {filtered.map((s) => (
              <TableRow key={s.subscription.id}>
                <TableCell>
                  <div>
                    <p className="font-medium">{s.tenant?.name ?? "—"}</p>
                    <p className="text-xs text-muted-foreground">{s.tenant?.subdomain}</p>
                  </div>
                </TableCell>
                <TableCell>{s.plan?.displayName ?? <span className="text-muted-foreground">Free</span>}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_BADGE[s.subscription.status] ?? "outline"}>{s.subscription.status}</Badge>
                </TableCell>
                <TableCell>{s.subscription.quantity}</TableCell>
                <TableCell className="capitalize">{s.subscription.billingCycle}</TableCell>
                <TableCell>
                  {s.subscription.currentPeriodEnd
                    ? new Date(s.subscription.currentPeriodEnd).toLocaleDateString(undefined)
                    : "—"}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" disabled={loading}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleAction("reactivate", s.subscription.tenantId)}>
                        Reactivate
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAction("suspend", s.subscription.tenantId)}>
                        Suspend
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => handleAction("downgrade", s.subscription.tenantId)}
                      >
                        Downgrade to Free
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

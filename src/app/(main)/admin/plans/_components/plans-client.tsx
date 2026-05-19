"use client";

import { useState, useTransition } from "react";

import { Loader2, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";

import { deletePlan, seedDefaultPlans } from "@/actions/admin-billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import { PlanForm } from "./plan-form";

interface Plan {
  id: string;
  name: string;
  displayName: string;
  pricePerUserMonthly: number;
  pricePerUserAnnual: number;
  includedUsers: number;
  maxUsers: number | null;
  isActive: boolean;
  isPublic: boolean;
  trialDays: number;
  supportTier: string;
  hasWhiteLabel: boolean;
  hasSandbox: boolean;
  sortOrder: number;
  isCustom: boolean;
  limits: string;
  enabledModules: string;
  description: string | null;
  annualDiscountPercent: number;
  minUsers: number;
  extraUserPriceMonthly: number;
  extraUserPriceAnnual: number;
  stripeProductId: string | null;
  stripePriceMonthlyId: string | null;
  stripePriceAnnualId: string | null;
  stripeExtraUserMonthlyPriceId: string | null;
  stripeExtraUserAnnualPriceId: string | null;
}

interface PlansClientProps {
  plans: Plan[];
}

/** Converts all null values in an object to undefined (for form props). */
function nullsToUndefined<T extends object>(obj: T): { [K in keyof T]: NonNullable<T[K]> | undefined } {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v === null ? undefined : v])) as {
    [K in keyof T]: NonNullable<T[K]> | undefined;
  };
}

export function PlansClient({ plans: initialPlans }: PlansClientProps) {
  const [plans, setPlans] = useState(initialPlans);
  const [createOpen, setCreateOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [seeding, startSeed] = useTransition();
  const [deleting, startDelete] = useTransition();

  function handleSeed() {
    startSeed(async () => {
      try {
        await seedDefaultPlans();
        toast.success("Default plans seeded. Reload to see them.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Seeding failed");
      }
    });
  }

  function handleDelete(id: string) {
    startDelete(async () => {
      try {
        await deletePlan(id);
        setPlans((prev) => prev.filter((p) => p.id !== id));
        toast.success("Plan deactivated.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Delete failed");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              New Plan
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col p-0 gap-0">
            <DialogHeader className="px-6 pt-6 pb-4 border-b">
              <DialogTitle className="text-lg">Create Plan</DialogTitle>
            </DialogHeader>
            <PlanForm onCancel={() => setCreateOpen(false)} onSuccess={() => setCreateOpen(false)} />
          </DialogContent>
        </Dialog>

        <Button size="sm" variant="outline" onClick={handleSeed} disabled={seeding}>
          {seeding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Seed Default Plans
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Monthly (per user)</TableHead>
              <TableHead>Included Users</TableHead>
              <TableHead>Trial</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No plans yet. Seed the defaults or create one manually.
                </TableCell>
              </TableRow>
            )}
            {plans.map((plan) => (
              <TableRow key={plan.id}>
                <TableCell>
                  <div>
                    <p className="font-medium">{plan.displayName}</p>
                    <p className="text-xs text-muted-foreground">{plan.name}</p>
                  </div>
                </TableCell>
                <TableCell>
                  {plan.pricePerUserMonthly === 0 ? "Free" : `€${(plan.pricePerUserMonthly / 100).toFixed(0)}`}
                </TableCell>
                <TableCell>{plan.includedUsers}</TableCell>
                <TableCell>{plan.trialDays > 0 ? `${plan.trialDays} days` : "—"}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {plan.isActive ? (
                      <Badge variant="default" className="text-xs">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Inactive
                      </Badge>
                    )}
                    {!plan.isPublic && (
                      <Badge variant="secondary" className="text-xs">
                        Hidden
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" disabled={deleting}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditPlan(plan)}>Edit</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(plan.id)}>
                        Deactivate
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editPlan} onOpenChange={(open) => !open && setEditPlan(null)}>
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle className="text-lg">Edit Plan — {editPlan?.displayName}</DialogTitle>
          </DialogHeader>
          {editPlan && (
            <PlanForm
              plan={nullsToUndefined(editPlan)}
              onCancel={() => setEditPlan(null)}
              onSuccess={() => setEditPlan(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

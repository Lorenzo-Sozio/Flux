"use client";

import { useTransition } from "react";

import { useRouter } from "next/navigation";

import { Check, ChevronRight, MoreHorizontal, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteOrder, type OrderStatus, updateOrderStatus } from "@/actions/orders";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { advanceLabelKey, isTerminalStatus, nextStatus } from "@/lib/order-status";

const STATUSES: OrderStatus[] = ["draft", "processing", "completed", "cancelled"];

/**
 * One status change, with the pending flag the buttons need: without it a slow
 * save invites a second click, and a second click on "Close order" is a second
 * write of the same thing.
 */
function useStatusChange(orderId: string) {
  const t = useTranslations("orders.detail");
  const tFail = useTranslations("orders.payments");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const change = (status: OrderStatus) =>
    startTransition(async () => {
      try {
        await updateOrderStatus(orderId, status);
        toast.success(t("statusUpdated"));
        router.refresh();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : tFail("recordFailed"));
      }
    });
  return { pending, change };
}

/**
 * The move anyone actually makes, as the hero's first button. It names the
 * destination rather than the movement — "Start processing" is a sentence the
 * reader can agree with before tapping; "Advance" is not.
 */
export function AdvanceStatusButton({ orderId, status }: { orderId: string; status: string }) {
  const t = useTranslations("orders.detail");
  const { pending, change } = useStatusChange(orderId);
  const key = advanceLabelKey(status);
  const next = nextStatus(status);
  if (!key || !next || isTerminalStatus(status)) return null;
  return (
    <Button size="sm" className="gap-1.5" disabled={pending} onClick={() => change(next)}>
      <ChevronRight className="size-3.5" aria-hidden />
      {t(key)}
    </Button>
  );
}

/**
 * The rarer moves: close in one step, set any status (cancel, reopen), delete.
 *
 * ⚠️ Nothing in here opens a dialog of its own — a dialog opened from a menu item
 * fights the menu for focus and closes with it. Delete asks through the browser's
 * own confirm, as it always has.
 */
export function OrderMoreMenu({
  orderId,
  status,
  canWrite,
  canDelete,
}: {
  orderId: string;
  status: string;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("orders.detail");
  const tStatus = useTranslations("orders.statuses");
  const tR = useTranslations("record");
  const tFail = useTranslations("orders.payments");
  const router = useRouter();
  const { pending, change } = useStatusChange(orderId);
  const [deleting, startDelete] = useTransition();

  // Only while it would skip a step. From "processing" this and the advance button
  // do the same thing, and two controls with one effect is the confusion this is
  // meant to remove.
  const offerClose = canWrite && !isTerminalStatus(status) && nextStatus(status) !== "completed";
  // The server deletes a draft or a cancelled order and refuses anything else; a
  // control that can only fail is not offered.
  const offerDelete = canDelete && (status === "draft" || status === "cancelled");

  if (!canWrite && !offerDelete) return null;

  const handleDelete = () => {
    if (!confirm(t("confirmDelete"))) return;
    startDelete(async () => {
      try {
        await deleteOrder(orderId);
        toast.success(t("orderDeleted"));
        router.push("/dashboard/sales/orders");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : tFail("recordFailed"));
      }
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5" disabled={pending || deleting}>
          <MoreHorizontal className="size-3.5" aria-hidden />
          {tR("more")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {offerClose && (
          <DropdownMenuItem className="max-md:min-h-11" onSelect={() => change("completed")}>
            <Check aria-hidden className="text-emerald-600 dark:text-emerald-400" />
            {t("closeOrder")}
          </DropdownMenuItem>
        )}
        {canWrite && (
          <>
            {offerClose && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-muted-foreground text-xs">{t("status")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={status} onValueChange={(v) => change(v as OrderStatus)}>
              {STATUSES.map((s) => (
                <DropdownMenuRadioItem key={s} value={s} className="max-md:min-h-11">
                  {tStatus(s)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
        {offerDelete && (
          <>
            {canWrite && <DropdownMenuSeparator />}
            <DropdownMenuItem variant="destructive" className="max-md:min-h-11" onSelect={handleDelete}>
              <Trash2 aria-hidden />
              {t("delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

"use client";

import { useState, useTransition } from "react";

import { addMonths, format, startOfMonth } from "date-fns";
import { Loader2, Plus, Save, Target, Trash2, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteSalesTarget, upsertSalesTarget } from "@/actions/targets";
import { ResponsiveRecordList } from "@/components/crm/record-cards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatCurrency } from "@/lib/utils";

type User = { id: string; name: string | null; email: string | null; role: string };
/**
 * Who a target belongs to, as the target query now returns it. Narrower than
 * `User` on purpose: that query used to load the person's whole row, secret
 * calendar address included, and this type accepting `role` is what let it.
 */
type TargetOwner = { id: string; name: string | null; email: string | null; image: string | null };
type SalesTarget = {
  id: string;
  userId: string;
  period: string;
  periodType: string;
  targetAmount: string;
  targetDeals: number | null;
  currency: string;
  user: TargetOwner;
};

interface Props {
  users: User[];
  initialTargets: SalesTarget[];
  /** Setting targets is for admins; everyone else reads them. */
  canManage: boolean;
}

function getNextMonths(count = 6): string[] {
  const today = startOfMonth(new Date());
  return Array.from({ length: count }, (_, i) => format(addMonths(today, i - 1), "yyyy-MM"));
}

export function TargetsClient({ users, initialTargets, canManage }: Props) {
  const t = useTranslations("settings.targets");
  const formatter = useFormatter();
  const tr = useTranslations("roles.roleLabel");
  const [targets, setTargets] = useState(initialTargets);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editDeals, setEditDeals] = useState("");
  const [editCurrency, setEditCurrency] = useState("EUR");
  const [isPending, startTransition] = useTransition();

  const months = getNextMonths(7);

  const getTarget = (userId: string, period: string) =>
    targets.find((tgt) => tgt.userId === userId && tgt.period === period);

  const startEdit = (tgt: SalesTarget) => {
    setEditingKey(`${tgt.userId}:${tgt.period}`);
    setEditAmount(String(parseFloat(tgt.targetAmount)));
    setEditDeals(tgt.targetDeals != null ? String(tgt.targetDeals) : "");
    setEditCurrency(tgt.currency);
  };

  const startNew = (userId: string, period: string) => {
    setEditingKey(`${userId}:${period}`);
    setEditAmount("");
    setEditDeals("");
    setEditCurrency("EUR");
  };

  const cancelEdit = () => {
    setEditingKey(null);
  };

  const saveEdit = (userId: string, period: string) => {
    const amount = parseFloat(editAmount);
    if (Number.isNaN(amount) || amount < 0) {
      toast.error(t("invalidAmount"));
      return;
    }
    startTransition(async () => {
      try {
        await upsertSalesTarget({
          userId,
          period,
          periodType: "month",
          targetAmount: amount,
          targetDeals: editDeals ? parseInt(editDeals, 10) : null,
          currency: editCurrency,
        });
        setTargets((prev) => {
          const filtered = prev.filter((tgt) => !(tgt.userId === userId && tgt.period === period));
          return [
            ...filtered,
            {
              id: `${userId}:${period}`,
              userId,
              period,
              periodType: "month",
              targetAmount: String(amount),
              targetDeals: editDeals ? parseInt(editDeals, 10) : null,
              currency: editCurrency,
              // Shaped like what the query returns, so the row added here and the
              // rows loaded from the server stay the same thing.
              user: (() => {
                const u = users.find((candidate) => candidate.id === userId);
                return { id: userId, name: u?.name ?? null, email: u?.email ?? null, image: null };
              })(),
            },
          ];
        });
        toast.success(t("savedToast"));
        cancelEdit();
      } catch {
        toast.error(t("saveFailed"));
      }
    });
  };

  const handleDelete = (id: string) => {
    startTransition(async () => {
      try {
        await deleteSalesTarget(id);
        setTargets((prev) => prev.filter((tgt) => tgt.id !== id));
        toast.success(t("removedToast"));
      } catch {
        toast.error(t("removeFailed"));
      }
    });
  };

  const roleLabel = (role: string) => (tr.has(role as never) ? tr(role as never) : role);
  const monthLabel = (m: string) =>
    formatter.dateTime(new Date(`${m}-01T00:00:00`), { month: "short", year: "numeric" });

  /**
   * One person's target for one month: the figure, the editor, or the way to set
   * one. Drawn by both the desktop matrix and the phone cards, so the two cannot
   * drift into offering different things.
   *
   * `card` is the phone layout. There the delete control cannot hang off the
   * figure's right edge as a 20px overlay — it would sit on top of the row's
   * edge — so it takes its own place in the row, at a size a finger can hit.
   */
  const renderCell = (user: User, period: string, layout: "table" | "card") => {
    const key = `${user.id}:${period}`;
    const target = getTarget(user.id, period);
    const isEditing = editingKey === key;
    const card = layout === "card";

    if (isEditing) {
      return (
        <div className={cn("flex flex-col gap-1.5", card ? "w-full" : "min-w-[130px]")}>
          <div className="flex items-center gap-1">
            <Select value={editCurrency} onValueChange={setEditCurrency}>
              <SelectTrigger className={cn("h-7 px-1.5 text-xs", card ? "w-20" : "w-16")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["EUR", "USD", "GBP"].map((c) => (
                  <SelectItem key={c} value={c} className="text-xs">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* In the card the text stays 16px until md: below that iOS zooms the
                page in on focus and leaves it there. */}
            <Input
              autoFocus
              type="number"
              min="0"
              step="100"
              value={editAmount}
              onChange={(e) => setEditAmount(e.target.value)}
              placeholder={t("amountPlaceholder")}
              className={cn("h-7 flex-1", card ? "md:text-xs" : "text-xs")}
            />
          </div>
          <Input
            type="number"
            min="0"
            value={editDeals}
            onChange={(e) => setEditDeals(e.target.value)}
            placeholder={t("dealsPlaceholder")}
            className={cn("h-7", card ? "md:text-xs" : "text-xs")}
          />
          <div className="flex items-center justify-end gap-1">
            <Button
              size="icon"
              variant="ghost"
              className={card ? "size-9" : "h-6 w-6"}
              onClick={cancelEdit}
              disabled={isPending}
            >
              <X className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              className={card ? "size-9" : "h-6 w-6"}
              onClick={() => saveEdit(user.id, period)}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            </Button>
          </div>
        </div>
      );
    }

    if (target) {
      const amount = (
        <button
          type="button"
          onClick={() => canManage && startEdit(target)}
          disabled={!canManage}
          className="font-semibold text-sm tabular-nums transition-colors enabled:hover:text-primary disabled:cursor-default"
        >
          {formatCurrency(parseFloat(target.targetAmount), {
            currency: target.currency,
            maximumFractionDigits: 0,
          })}
        </button>
      );
      const deals = target.targetDeals != null && (
        <span className="text-muted-foreground text-xs">{t("dealsLabel", { count: target.targetDeals })}</span>
      );

      if (card) {
        return (
          <div className="flex items-center gap-1">
            <div className="flex flex-col items-end">
              {amount}
              {deals}
            </div>
            {canManage && (
              <Button
                size="icon"
                variant="ghost"
                className="size-9 text-destructive hover:text-destructive"
                onClick={() => handleDelete(target.id)}
                disabled={isPending}
                aria-label={t("removeTarget")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        );
      }

      return (
        <div className="group relative inline-flex flex-col items-center gap-0.5">
          {amount}
          {deals}
          {canManage && (
            <Button
              size="icon"
              variant="ghost"
              className="-right-5 absolute top-0 h-5 w-5 text-destructive opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
              onClick={() => handleDelete(target.id)}
              disabled={isPending}
              aria-label={t("removeTarget")}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      );
    }

    if (!canManage) return <span className="text-muted-foreground/40">—</span>;

    return (
      <button
        type="button"
        onClick={() => startNew(user.id, period)}
        className={cn(
          "text-muted-foreground/40 transition-colors hover:text-primary",
          card && "flex size-9 items-center justify-center",
        )}
        title={t("setTargetTitle")}
        aria-label={t("setTargetTitle")}
      >
        <Plus className="mx-auto h-4 w-4" />
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 font-bold text-2xl tracking-tight">
          <Target className="h-6 w-6 shrink-0 text-primary" /> {t("title")}
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>

      {/*
        ⚠️ A person by seven months is a spreadsheet, and on a phone a spreadsheet
        is a window two cells wide that you drag around. Below md each person is a
        card and the months run down it, so one person's year is one scroll and
        the figure you tap to edit is under your thumb, not past the edge.
      */}
      <ResponsiveRecordList
        cards={
          <div className="space-y-3">
            <p className="font-medium text-muted-foreground text-sm">{t("cardTitle")}</p>
            <ul className="space-y-3">
              {users.map((user) => (
                <li key={user.id} className="rounded-lg border bg-card">
                  <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
                    <p className="min-w-0 flex-1 truncate font-medium">{user.name ?? user.email}</p>
                    {user.role && (
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {roleLabel(user.role)}
                      </Badge>
                    )}
                  </div>
                  <ul className="divide-y">
                    {months.map((period) => {
                      const isEditing = editingKey === `${user.id}:${period}`;
                      return (
                        <li
                          key={period}
                          className={cn(
                            "flex min-h-12 items-center justify-between gap-3 px-3 py-1.5",
                            isEditing && "flex-col items-stretch py-3",
                          )}
                        >
                          <span className="text-muted-foreground text-sm">{monthLabel(period)}</span>
                          {renderCell(user, period, "card")}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        }
        table={
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="font-medium text-muted-foreground text-sm">{t("cardTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="sticky left-0 min-w-[160px] bg-muted/40 px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">
                        {t("colUser")}
                      </th>
                      {months.map((m) => (
                        <th
                          key={m}
                          className="min-w-[140px] px-3 py-2.5 text-center font-medium text-muted-foreground text-xs"
                        >
                          {monthLabel(m)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {users.map((user) => (
                      <tr key={user.id} className="transition-colors hover:bg-muted/20">
                        <td className="sticky left-0 bg-background px-4 py-3">
                          <div>
                            <p className="font-medium leading-none">{user.name ?? user.email}</p>
                            {user.role && (
                              <Badge variant="outline" className="mt-1 text-xs">
                                {roleLabel(user.role)}
                              </Badge>
                            )}
                          </div>
                        </td>
                        {months.map((period) => (
                          <td key={period} className="px-3 py-2.5 text-center">
                            {renderCell(user, period, "table")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        }
      />

      <p className="text-muted-foreground text-xs">{t("footerHint")}</p>
    </div>
  );
}

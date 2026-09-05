"use client";

import { useState, useTransition } from "react";

import { addMonths, format, startOfMonth } from "date-fns";
import { Loader2, Plus, Save, Target, Trash2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteSalesTarget, upsertSalesTarget } from "@/actions/targets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";

type User = { id: string; name: string | null; email: string | null; role: string };
type SalesTarget = {
  id: string;
  userId: string;
  period: string;
  periodType: string;
  targetAmount: string;
  targetDeals: number | null;
  currency: string;
  user: User;
};

interface Props {
  users: User[];
  initialTargets: SalesTarget[];
}

function getNextMonths(count = 6): string[] {
  const today = startOfMonth(new Date());
  return Array.from({ length: count }, (_, i) => format(addMonths(today, i - 1), "yyyy-MM"));
}

export function TargetsClient({ users, initialTargets }: Props) {
  const t = useTranslations("settings.targets");
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
              user: users.find((u) => u.id === userId)!,
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-bold text-2xl tracking-tight">
            <Target className="h-6 w-6 text-primary" /> {t("title")}
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
      </div>

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
                      {format(new Date(`${m}-01`), "MMM yyyy")}
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
                        <Badge variant="outline" className="mt-1 text-xs capitalize">
                          {user.role}
                        </Badge>
                      </div>
                    </td>
                    {months.map((period) => {
                      const key = `${user.id}:${period}`;
                      const target = getTarget(user.id, period);
                      const isEditing = editingKey === key;

                      return (
                        <td key={period} className="px-3 py-2.5 text-center">
                          {isEditing ? (
                            <div className="flex min-w-[130px] flex-col gap-1.5">
                              <div className="flex items-center gap-1">
                                <Select value={editCurrency} onValueChange={setEditCurrency}>
                                  <SelectTrigger className="h-7 w-16 px-1.5 text-xs">
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
                                <Input
                                  autoFocus
                                  type="number"
                                  min="0"
                                  step="100"
                                  value={editAmount}
                                  onChange={(e) => setEditAmount(e.target.value)}
                                  placeholder={t("amountPlaceholder")}
                                  className="h-7 flex-1 text-xs"
                                />
                              </div>
                              <Input
                                type="number"
                                min="0"
                                value={editDeals}
                                onChange={(e) => setEditDeals(e.target.value)}
                                placeholder={t("dealsPlaceholder")}
                                className="h-7 text-xs"
                              />
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-6 w-6"
                                  onClick={cancelEdit}
                                  disabled={isPending}
                                >
                                  <X className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => saveEdit(user.id, period)}
                                  disabled={isPending}
                                >
                                  {isPending ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Save className="h-3 w-3" />
                                  )}
                                </Button>
                              </div>
                            </div>
                          ) : target ? (
                            <div className="group relative inline-flex flex-col items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => startEdit(target)}
                                className="font-semibold text-sm tabular-nums transition-colors hover:text-primary"
                              >
                                {formatCurrency(parseFloat(target.targetAmount), {
                                  currency: target.currency,
                                  maximumFractionDigits: 0,
                                })}
                              </button>
                              {target.targetDeals != null && (
                                <span className="text-muted-foreground text-xs">
                                  {t("dealsLabel", { count: target.targetDeals })}
                                </span>
                              )}
                              <Button
                                size="icon"
                                variant="ghost"
                                className="-right-5 absolute top-0 h-5 w-5 text-destructive opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                                onClick={() => handleDelete(target.id)}
                                disabled={isPending}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startNew(user.id, period)}
                              className="text-muted-foreground/40 transition-colors hover:text-primary"
                              title={t("setTargetTitle")}
                            >
                              <Plus className="mx-auto h-4 w-4" />
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">{t("footerHint")}</p>
    </div>
  );
}

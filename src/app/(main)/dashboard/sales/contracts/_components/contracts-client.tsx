"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { type ContractRow, createContract, deleteContract, updateContract } from "@/actions/contracts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useCurrency } from "@/hooks/use-currency";
import { BILLING_PERIODS, type ContractPhase } from "@/lib/contract-terms";
import { cn } from "@/lib/utils";

const VIEWS = ["all", "renewal_due", "active", "expired", "cancelled"] as const;

const PHASE_STYLE: Record<ContractPhase, string> = {
  active: "border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400",
  renewal_due:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  expired: "border-rose-300 text-rose-700 dark:border-rose-800 dark:text-rose-400",
  upcoming: "border-sky-300 text-sky-700 dark:border-sky-800 dark:text-sky-400",
  draft: "text-muted-foreground",
  cancelled: "text-muted-foreground line-through",
};

interface Form {
  title: string;
  companyId: string;
  ownerId: string;
  status: "draft" | "active" | "cancelled";
  amount: string;
  currency: string;
  billingPeriod: string;
  startDate: string;
  endDate: string;
  autoRenew: boolean;
  renewalTermMonths: string;
  noticeDays: string;
  notes: string;
}

const EMPTY: Form = {
  title: "",
  companyId: "",
  ownerId: "",
  status: "active",
  amount: "",
  currency: "EUR",
  billingPeriod: "annual",
  startDate: new Date().toISOString().slice(0, 10),
  endDate: "",
  autoRenew: false,
  renewalTermMonths: "12",
  noticeDays: "30",
  notes: "",
};

function inView(row: ContractRow, view: string): boolean {
  if (view === "all") return true;
  if (view === "active") return row.phase === "active" || row.phase === "upcoming";
  return row.phase === view;
}

export function ContractsClient({
  data,
  companies,
  users,
  view,
  canWrite,
  canDelete,
}: {
  data: { rows: ContractRow[]; on: string; mrr: number };
  companies: { id: string; name: string }[];
  users: { id: string; name: string | null; email: string | null }[];
  view: string;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const t = useTranslations("contracts");
  const router = useRouter();
  const { formatAmount } = useCurrency();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ContractRow | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const rows = data.rows.filter((r) => inView(r, view));
  const due = data.rows.filter((r) => r.phase === "renewal_due").length;
  const earning = data.rows.filter((r) => r.phase === "active" || r.phase === "renewal_due").length;
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  };

  const openEdit = (row: ContractRow) => {
    setEditing(row);
    setForm({
      title: row.title,
      companyId: row.companyId ?? "",
      ownerId: row.ownerId ?? "",
      status: row.status as Form["status"],
      amount: String(row.amount),
      currency: row.currency,
      billingPeriod: row.billingPeriod,
      startDate: row.startDate,
      endDate: row.endDate ?? "",
      autoRenew: row.autoRenew,
      renewalTermMonths: String(row.renewalTermMonths ?? 12),
      noticeDays: String(row.noticeDays),
      notes: row.notes ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const input = {
        title: form.title,
        companyId: form.companyId,
        ownerId: form.ownerId || null,
        status: form.status,
        amount: Number(form.amount.replace(",", ".")),
        currency: form.currency,
        billingPeriod: form.billingPeriod,
        startDate: form.startDate,
        endDate: form.endDate || null,
        autoRenew: form.autoRenew,
        renewalTermMonths: form.autoRenew ? Number(form.renewalTermMonths) : null,
        noticeDays: Number(form.noticeDays),
        notes: form.notes,
      };
      const result = editing ? await updateContract(editing.id, input) : await createContract(input);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(t("saved"));
      setOpen(false);
      router.refresh();
    } catch {
      toast.error(t("failed"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    try {
      await deleteContract(deleteId);
      toast.success(t("deleted"));
      router.refresh();
    } catch {
      toast.error(t("failed"));
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        {canWrite && (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="h-4 w-4" />
            {t("newContract")}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-medium text-muted-foreground text-sm">{t("mrr")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl tabular-nums">{formatAmount(data.mrr)}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("mrrDesc", { count: earning })}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="font-medium text-muted-foreground text-sm">{t("arr")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="font-bold text-2xl tabular-nums">{formatAmount(data.mrr * 12)}</div>
            <p className="mt-1 text-muted-foreground text-xs">{t("arrDesc")}</p>
          </CardContent>
        </Card>
        <Link href="?view=renewal_due" className="group">
          <Card
            className={cn(
              "transition-shadow group-hover:shadow-md",
              due > 0 && "border-amber-300 dark:border-amber-800",
            )}
          >
            <CardHeader className="pb-2">
              <CardTitle className="font-medium text-muted-foreground text-sm">{t("renewalsDue")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="font-bold text-2xl tabular-nums">{due}</div>
              <p className="mt-1 text-muted-foreground text-xs">{t("renewalsDueDesc")}</p>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Button key={v} asChild size="sm" variant={view === v ? "default" : "outline"}>
            <Link href={v === "all" ? "?" : `?view=${v}`} scroll={false}>
              {t(`views.${v}`)}
            </Link>
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground text-sm">{t("empty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("contract")}</TableHead>
                  <TableHead>{t("status")}</TableHead>
                  <TableHead className="text-right">{t("amount")}</TableHead>
                  <TableHead className="text-right">{t("monthly")}</TableHead>
                  <TableHead>{t("termEnd")}</TableHead>
                  <TableHead>{t("noticeBy")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="min-w-0">
                      <p className="font-medium">{row.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {row.companyName ?? t("noCompany")}
                        {row.ownerName ? ` · ${row.ownerName}` : ""}
                      </p>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("whitespace-nowrap", PHASE_STYLE[row.phase])}>
                        {t(`phases.${row.phase}`)}
                      </Badge>
                      {row.autoRenew && <p className="mt-1 text-[11px] text-muted-foreground">{t("autoRenews")}</p>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      {formatAmount(Number(row.amount))}
                      <span className="ml-1 text-muted-foreground text-xs">/ {t(`periods.${row.billingPeriod}`)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatAmount(row.monthly)}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{row.termEnd ?? "—"}</TableCell>
                    <TableCell
                      className={cn(
                        "whitespace-nowrap tabular-nums",
                        row.phase === "renewal_due" && "font-medium text-amber-700 dark:text-amber-400",
                      )}
                    >
                      {row.noticeBy ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {canWrite && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(row)}
                            aria-label={t("edit")}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteId(row.id)}
                            aria-label={t("delete")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">{t("footnote", { on: data.on })}</p>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? t("edit") : t("newContract")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="contract-title">{t("titleLabel")}</Label>
              <Input
                id="contract-title"
                className="mt-1.5"
                value={form.title}
                placeholder={t("titlePlaceholder")}
                onChange={(e) => set({ title: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("company")}</Label>
              <div className="mt-1.5">
                <SearchableSelect
                  options={companies.map((c) => ({ value: c.id, label: c.name }))}
                  value={form.companyId}
                  onChange={(companyId) => set({ companyId })}
                  placeholder={t("chooseCompany")}
                />
              </div>
            </div>
            <div>
              <Label>{t("owner")}</Label>
              <div className="mt-1.5">
                <SearchableSelect
                  options={users.map((u) => ({ value: u.id, label: u.name ?? u.email ?? u.id }))}
                  value={form.ownerId}
                  onChange={(ownerId) => set({ ownerId })}
                  placeholder={t("ownerDefault")}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="contract-amount">{t("amountLabel")}</Label>
              <Input
                id="contract-amount"
                className="mt-1.5"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => set({ amount: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("period")}</Label>
                <Select value={form.billingPeriod} onValueChange={(billingPeriod) => set({ billingPeriod })}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BILLING_PERIODS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {t(`periods.${p}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="contract-currency">{t("currency")}</Label>
                <Input
                  id="contract-currency"
                  className="mt-1.5 uppercase"
                  maxLength={3}
                  value={form.currency}
                  onChange={(e) => set({ currency: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="contract-start">{t("startDate")}</Label>
              <Input
                id="contract-start"
                type="date"
                className="mt-1.5"
                value={form.startDate}
                onChange={(e) => set({ startDate: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="contract-end">{t("endDate")}</Label>
              <Input
                id="contract-end"
                type="date"
                className="mt-1.5"
                value={form.endDate}
                onChange={(e) => set({ endDate: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="contract-notice">{t("noticeDays")}</Label>
              <Input
                id="contract-notice"
                type="number"
                min={0}
                max={365}
                className="mt-1.5"
                value={form.noticeDays}
                onChange={(e) => set({ noticeDays: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("statusLabel")}</Label>
              <Select value={form.status} onValueChange={(status) => set({ status: status as Form["status"] })}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["draft", "active", "cancelled"] as const).map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`statuses.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Checkbox
                id="contract-autorenew"
                checked={form.autoRenew}
                onCheckedChange={(on) => set({ autoRenew: on === true })}
              />
              <Label htmlFor="contract-autorenew" className="cursor-pointer">
                {t("autoRenewLabel")}
              </Label>
              {form.autoRenew && (
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={t("renewalMonths")}
                    type="number"
                    min={1}
                    max={120}
                    className="h-8 w-20"
                    value={form.renewalTermMonths}
                    onChange={(e) => set({ renewalTermMonths: e.target.value })}
                  />
                  <span className="text-muted-foreground text-sm">{t("renewalMonths")}</span>
                </div>
              )}
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="contract-notes">{t("notes")}</Label>
              <Textarea
                id="contract-notes"
                rows={3}
                className="mt-1.5"
                value={form.notes}
                onChange={(e) => set({ notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("cancel")}
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? t("saving") : t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

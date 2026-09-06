"use client";

import { useEffect, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { DollarSign, Loader2, Package, Pencil, Plus, Search, Tag, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { createProduct, deleteProduct, toggleProductActive, updateProduct } from "@/actions/products";
import { EmptyState } from "@/components/crm/empty-state";
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
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useCurrency } from "@/hooks/use-currency";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type Product = {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  price: string;
  taxPercent: string | null;
  unit: string | null;
  category: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// ── Schema ────────────────────────────────────────────────────────────────────

const formSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  sku: z.string().optional(),
  price: z.coerce.number().min(0, "Must be ≥ 0"),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  unit: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});
type FormValues = z.infer<typeof formSchema>;

// ── Product form dialog ───────────────────────────────────────────────────────

function ProductDialog({
  open,
  onOpenChange,
  product,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  product?: Product;
  onSaved: (p: Product) => void;
}) {
  const t = useTranslations("products");
  const [submitting, setSubmitting] = useState(false);
  const isEdit = !!product;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: product?.name ?? "",
      description: product?.description ?? "",
      sku: product?.sku ?? "",
      price: product ? Number(product.price) : 0,
      taxPercent: product ? Number(product.taxPercent ?? 0) : 0,
      unit: product?.unit ?? "",
      category: product?.category ?? "",
      isActive: product?.isActive ?? true,
    },
  });

  // The product being edited is the trigger. `form` is a new object on every
  // render, so depending on it would reset the fields under the hands of whoever
  // is typing in them.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the product is the trigger
  useEffect(() => {
    form.reset({
      name: product?.name ?? "",
      description: product?.description ?? "",
      sku: product?.sku ?? "",
      price: product ? Number(product.price) : 0,
      taxPercent: product ? Number(product.taxPercent ?? 0) : 0,
      unit: product?.unit ?? "",
      category: product?.category ?? "",
      isActive: product?.isActive ?? true,
    });
  }, [product]);

  const onSubmit = async (data: FormValues) => {
    setSubmitting(true);
    try {
      if (isEdit) {
        const updated = await updateProduct(product.id, data);
        onSaved(updated as Product);
        toast.success(t("updateSuccess"));
      } else {
        const created = await createProduct(data);
        onSaved(created as Product);
        toast.success(t("createSuccess"));
      }
      onOpenChange(false);
      form.reset();
    } catch {
      toast.error(isEdit ? t("updateFailed") : t("createFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!submitting) {
          onOpenChange(v);
          if (!v) form.reset();
        }
      }}
    >
      <DialogContent className="gap-0 p-0 sm:max-w-[480px]">
        <DialogHeader className="border-b px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-4.5 w-4.5 text-primary" />
            {isEdit ? t("dialog.editTitle") : t("dialog.newTitle")}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-4 px-6 py-5">
            {/* Name */}
            <div className="space-y-1.5">
              <Label>
                {t("dialog.nameLabel")} <span className="text-destructive">*</span>
              </Label>
              <Input {...form.register("name")} placeholder={t("form.namePlaceholder")} />
              {form.formState.errors.name && (
                <p className="text-destructive text-xs">{form.formState.errors.name.message}</p>
              )}
            </div>

            {/* SKU + Price */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground" /> SKU
                </Label>
                <Input {...form.register("sku")} placeholder="ABC-001" className="font-mono text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5 text-muted-foreground" /> Price{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input type="number" step="0.01" min="0" {...form.register("price")} placeholder="0.00" />
                {form.formState.errors.price && (
                  <p className="text-destructive text-xs">{form.formState.errors.price.message}</p>
                )}
              </div>
            </div>

            {/* Category + Tax % */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>
                  {t("category")} <span className="font-normal text-muted-foreground">{t("dialog.optional")}</span>
                </Label>
                <Input {...form.register("category")} placeholder={t("form.categoryPlaceholder")} />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {t("taxRate")} % <span className="font-normal text-muted-foreground">{t("dialog.optional")}</span>
                </Label>
                <Input type="number" step="0.01" min="0" max="100" {...form.register("taxPercent")} placeholder="0" />
              </div>
            </div>

            {/* Unit */}
            <div className="space-y-1.5">
              <Label>
                {t("dialog.unitLabel")}{" "}
                <span className="font-normal text-muted-foreground">{t("dialog.optional")}</span>
              </Label>
              <Input {...form.register("unit")} placeholder={t("form.unitPlaceholder")} />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label>
                {t("dialog.descriptionLabel")}{" "}
                <span className="font-normal text-muted-foreground">{t("dialog.optional")}</span>
              </Label>
              <Textarea
                {...form.register("description")}
                placeholder={t("form.descriptionPlaceholder")}
                className="min-h-[72px] resize-none"
              />
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
              <div>
                <p className="font-medium text-sm">{t("dialog.activeLabel")}</p>
                <p className="text-muted-foreground text-xs">{t("dialog.activeDesc")}</p>
              </div>
              <Switch checked={form.watch("isActive")} onCheckedChange={(v) => form.setValue("isActive", v)} />
            </div>
          </div>

          <DialogFooter className="border-t bg-muted/10 px-6 py-4">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="gap-2">
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? t("dialog.saveChanges") : t("dialog.createProduct")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  products: Product[];
}

export function ProductsClient({ products: initial }: Props) {
  const t = useTranslations("products");
  const te = useTranslations("emptyStates");
  const { formatAmount } = useCurrency();
  const _router = useRouter();
  const [, startTransition] = useTransition();
  const [products, setProducts] = useState(initial);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | undefined>(undefined);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Filtered list
  const filtered = products.filter((p) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.sku ?? "").toLowerCase().includes(q) ||
      (p.category ?? "").toLowerCase().includes(q);
    const matchFilter = filter === "all" ? true : filter === "active" ? p.isActive : !p.isActive;
    return matchSearch && matchFilter;
  });

  const activeCount = products.filter((p) => p.isActive).length;
  const inactiveCount = products.filter((p) => !p.isActive).length;

  const handleOpenCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const handleOpenEdit = (p: Product) => {
    setEditing(p);
    setDialogOpen(true);
  };

  const handleSaved = (saved: Product) => {
    setProducts((prev) => {
      const idx = prev.findIndex((p) => p.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
  };

  const handleToggleActive = (product: Product) => {
    const newVal = !product.isActive;
    startTransition(async () => {
      await toggleProductActive(product.id, newVal);
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, isActive: newVal } : p)));
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteProduct(deleteTarget.id);
      setProducts((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      toast.success(t("deleteSuccess"));
    } catch {
      toast.error(t("deleteFailed"));
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const formatPrice = (price: string) => formatAmount(Number(price));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("subtitle")}</p>
        </div>
        <Button onClick={handleOpenCreate} className="gap-1.5">
          <Plus className="h-4 w-4" />
          {t("newProduct")}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t("total"), value: products.length, active: filter === "all", onClick: () => setFilter("all") },
          { label: t("active"), value: activeCount, active: filter === "active", onClick: () => setFilter("active") },
          {
            label: t("inactive"),
            value: inactiveCount,
            active: filter === "inactive",
            onClick: () => setFilter("inactive"),
          },
        ].map(({ label, value, active, onClick }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            className={cn(
              "rounded-lg border px-4 py-3 text-left transition-colors",
              active ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/30",
            )}
          >
            <p className="font-bold text-xl leading-none">{value}</p>
            <p className="mt-0.5 text-muted-foreground text-xs">{label}</p>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-muted-foreground text-xs">
              <th className="px-4 py-2.5 text-left font-medium">{t("columns.name")}</th>
              <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">{t("columns.sku")}</th>
              <th className="hidden px-4 py-2.5 text-left font-medium lg:table-cell">{t("category")}</th>
              <th className="px-4 py-2.5 text-left font-medium">{t("columns.price")}</th>
              <th className="hidden px-4 py-2.5 text-left font-medium md:table-cell">{t("taxRate")} %</th>
              <th className="px-4 py-2.5 text-center font-medium">{t("columns.active")}</th>
              <th className="w-20 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-0">
                  {search || filter !== "all" ? (
                    <EmptyState icon={Package} title={te("filteredTitle")} description={te("filteredDescription")} />
                  ) : (
                    <EmptyState
                      icon={Package}
                      title={te("products.title")}
                      description={te("products.description")}
                      action={
                        <Button size="sm" onClick={handleOpenCreate}>
                          {t("newProduct")}
                        </Button>
                      }
                    />
                  )}
                </td>
              </tr>
            ) : (
              filtered.map((product) => (
                <tr key={product.id} className="group transition-colors hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <p className={cn("font-medium", !product.isActive && "text-muted-foreground")}>{product.name}</p>
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    {product.sku ? (
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{product.sku}</span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 lg:table-cell">
                    {product.category ? (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs">
                        {product.category}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div>
                      <span className="font-semibold tabular-nums">{formatPrice(product.price)}</span>
                      {product.unit && <span className="ml-1 text-muted-foreground text-xs">/ {product.unit}</span>}
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <span className="text-sm tabular-nums">
                      {parseFloat(product.taxPercent ?? "0") > 0 ? (
                        `${parseFloat(product.taxPercent ?? "0")}%`
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(product)}
                      className="inline-flex items-center justify-center"
                      title={product.isActive ? t("deactivate") : t("activate")}
                    >
                      {product.isActive ? (
                        <ToggleRight className="h-5 w-5 text-emerald-500" />
                      ) : (
                        <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleOpenEdit(product)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(product)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filtered.length > 0 && (
        <p className="text-right text-muted-foreground text-xs">
          {t("showingOf", { shown: filtered.length, total: products.length })}
        </p>
      )}

      {/* Create / Edit dialog */}
      <ProductDialog open={dialogOpen} onOpenChange={setDialogOpen} product={editing} onSaved={handleSaved} />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> {t("deleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("deleteProduct")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

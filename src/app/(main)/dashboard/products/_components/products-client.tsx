"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Package,
  Plus,
  Pencil,
  Trash2,
  Search,
  ToggleLeft,
  ToggleRight,
  Loader2,
  Tag,
  DollarSign,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  createProduct,
  updateProduct,
  deleteProduct,
  toggleProductActive,
} from "@/actions/products";

// ── Types ─────────────────────────────────────────────────────────────────────

type Product = {
  id: string;
  name: string;
  description: string | null;
  sku: string | null;
  price: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// ── Schema ────────────────────────────────────────────────────────────────────

const formSchema = z.object({
  name:        z.string().min(1, "Name is required"),
  description: z.string().optional(),
  sku:         z.string().optional(),
  price:       z.coerce.number().min(0, "Must be ≥ 0"),
  isActive:    z.boolean().default(true),
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
  const [submitting, setSubmitting] = useState(false);
  const isEdit = !!product;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name:        product?.name ?? "",
      description: product?.description ?? "",
      sku:         product?.sku ?? "",
      price:       product ? Number(product.price) : 0,
      isActive:    product?.isActive ?? true,
    },
  });

  // Reset when product changes
  useState(() => {
    form.reset({
      name:        product?.name ?? "",
      description: product?.description ?? "",
      sku:         product?.sku ?? "",
      price:       product ? Number(product.price) : 0,
      isActive:    product?.isActive ?? true,
    });
  });

  const onSubmit = async (data: FormValues) => {
    setSubmitting(true);
    try {
      if (isEdit) {
        const updated = await updateProduct(product.id, data);
        onSaved(updated as Product);
        toast.success("Product updated.");
      } else {
        const created = await createProduct(data);
        onSaved(created as Product);
        toast.success("Product created.");
      }
      onOpenChange(false);
      form.reset();
    } catch {
      toast.error(isEdit ? "Failed to update product." : "Failed to create product.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!submitting) { onOpenChange(v); if (!v) form.reset(); } }}>
      <DialogContent className="sm:max-w-[480px] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-4.5 w-4.5 text-primary" />
            {isEdit ? "Edit Product" : "New Product"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div className="px-6 py-5 space-y-4">
            {/* Name */}
            <div className="space-y-1.5">
              <Label>Name <span className="text-destructive">*</span></Label>
              <Input {...form.register("name")} placeholder="Product name…" />
              {form.formState.errors.name && (
                <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
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
                  <DollarSign className="h-3.5 w-3.5 text-muted-foreground" /> Price <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  {...form.register("price")}
                  placeholder="0.00"
                />
                {form.formState.errors.price && (
                  <p className="text-xs text-destructive">{form.formState.errors.price.message}</p>
                )}
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label>Description <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea
                {...form.register("description")}
                placeholder="Describe the product…"
                className="resize-none min-h-[72px]"
              />
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between rounded-lg border px-4 py-3">
              <div>
                <p className="text-sm font-medium">Active</p>
                <p className="text-xs text-muted-foreground">Inactive products won't appear in quote line items</p>
              </div>
              <Switch
                checked={form.watch("isActive")}
                onCheckedChange={(v) => form.setValue("isActive", v)}
              />
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t bg-muted/10">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="gap-2">
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? "Save Changes" : "Create Product"}
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
  const router = useRouter();
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
    const matchSearch = !q || p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q);
    const matchFilter =
      filter === "all" ? true :
      filter === "active" ? p.isActive :
      !p.isActive;
    return matchSearch && matchFilter;
  });

  const activeCount   = products.filter((p) => p.isActive).length;
  const inactiveCount = products.filter((p) => !p.isActive).length;

  const handleOpenCreate = () => { setEditing(undefined); setDialogOpen(true); };
  const handleOpenEdit   = (p: Product) => { setEditing(p); setDialogOpen(true); };

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
      setProducts((prev) =>
        prev.map((p) => p.id === product.id ? { ...p, isActive: newVal } : p),
      );
    });
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteProduct(deleteTarget.id);
      setProducts((prev) => prev.filter((p) => p.id !== deleteTarget.id));
      toast.success("Product deleted.");
    } catch {
      toast.error("Failed to delete product.");
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const formatPrice = (price: string) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(price));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Products</h1>
          <p className="text-muted-foreground text-sm">Manage your product catalog used in quotes and orders.</p>
        </div>
        <Button onClick={handleOpenCreate} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Product
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total",    value: products.length, active: filter === "all",      onClick: () => setFilter("all") },
          { label: "Active",   value: activeCount,     active: filter === "active",   onClick: () => setFilter("active") },
          { label: "Inactive", value: inactiveCount,   active: filter === "inactive", onClick: () => setFilter("inactive") },
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
            <p className="text-xl font-bold leading-none">{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by name or SKU…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
              <th className="px-4 py-2.5 text-left font-medium">Name</th>
              <th className="px-4 py-2.5 text-left font-medium hidden sm:table-cell">SKU</th>
              <th className="px-4 py-2.5 text-left font-medium">Price</th>
              <th className="px-4 py-2.5 text-left font-medium hidden md:table-cell">Description</th>
              <th className="px-4 py-2.5 text-center font-medium">Active</th>
              <th className="w-20 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-14 text-center">
                  <Package className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-muted-foreground text-sm">
                    {search || filter !== "all" ? "No products match your search." : "No products yet. Create the first one."}
                  </p>
                </td>
              </tr>
            ) : (
              filtered.map((product) => (
                <tr key={product.id} className="hover:bg-muted/30 transition-colors group">
                  <td className="px-4 py-3">
                    <p className={cn("font-medium", !product.isActive && "text-muted-foreground")}>
                      {product.name}
                    </p>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    {product.sku ? (
                      <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{product.sku}</span>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold tabular-nums">{formatPrice(product.price)}</span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <p className="text-xs text-muted-foreground truncate max-w-[240px]">
                      {product.description ?? <span className="text-muted-foreground/40">—</span>}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(product)}
                      className="inline-flex items-center justify-center"
                      title={product.isActive ? "Deactivate" : "Activate"}
                    >
                      {product.isActive ? (
                        <ToggleRight className="h-5 w-5 text-emerald-500" />
                      ) : (
                        <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleOpenEdit(product)}
                      >
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
        <p className="text-xs text-muted-foreground text-right">
          Showing {filtered.length} of {products.length} products
        </p>
      )}

      {/* Create / Edit dialog */}
      <ProductDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        product={editing}
        onSaved={handleSaved}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> will be permanently deleted. This cannot be undone.
              Products linked to existing quotes will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

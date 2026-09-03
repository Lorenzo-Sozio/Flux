"use server";

import { revalidatePath } from "next/cache";

import { desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";

import { products } from "@/db/schema";
import { requirePlanModule, requireWriteAccess } from "@/lib/auth-guard";
import { getDb } from "@/lib/tenant-context";

// ── Schema ────────────────────────────────────────────────────────────────────

const productSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  sku: z.string().optional(),
  price: z.coerce.number().min(0, "Price must be ≥ 0"),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  unit: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  isActive: z.boolean().default(true),
});

// ── Queries ───────────────────────────────────────────────────────────────────

export async function getProducts(search?: string) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(products)
    .where(search ? or(ilike(products.name, `%${search}%`), ilike(products.sku, `%${search}%`)) : undefined)
    .orderBy(desc(products.createdAt));
  return rows;
}

// ── Mutations ─────────────────────────────────────────────────────────────────

export async function createProduct(data: z.infer<typeof productSchema>) {
  await requireWriteAccess();
  await requirePlanModule("sales");
  const db = await getDb();
  const validated = productSchema.parse(data);
  const [product] = await db
    .insert(products)
    .values({
      name: validated.name,
      description: validated.description,
      sku: validated.sku,
      price: String(validated.price),
      taxPercent: String(validated.taxPercent),
      unit: validated.unit ?? null,
      category: validated.category ?? null,
      isActive: validated.isActive,
    })
    .returning();
  revalidatePath("/dashboard/sales/products");
  return product;
}

export async function updateProduct(id: string, data: Partial<z.infer<typeof productSchema>>) {
  await requireWriteAccess();
  await requirePlanModule("sales");
  const db = await getDb();
  const [product] = await db
    .update(products)
    .set({
      ...data,
      price: data.price !== undefined ? String(data.price) : undefined,
      taxPercent: data.taxPercent !== undefined ? String(data.taxPercent) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(products.id, id))
    .returning();
  revalidatePath("/dashboard/sales/products");
  return product;
}

export async function toggleProductActive(id: string, isActive: boolean) {
  await requireWriteAccess();
  await requirePlanModule("sales");
  const db = await getDb();
  await db.update(products).set({ isActive, updatedAt: new Date() }).where(eq(products.id, id));
  revalidatePath("/dashboard/sales/products");
}

export async function deleteProduct(id: string) {
  await requireWriteAccess();
  await requirePlanModule("sales");
  const db = await getDb();
  await db.delete(products).where(eq(products.id, id));
  revalidatePath("/dashboard/sales/products");
}

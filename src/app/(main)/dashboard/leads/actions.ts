"use server";

import { revalidatePath } from "next/cache";

import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { auth } from "@/auth";
import { getDb } from "@/lib/tenant-context";
import { leads } from "@/db/schema";

const emptyStringToNull = z.union([z.string(), z.null(), z.undefined()]).transform((v) => (!v ? null : v));

const leadSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  jobTitle: emptyStringToNull,
  email: z
    .union([z.string().email("Invalid email address"), z.literal(""), z.null(), z.undefined()])
    .transform((v) => (!v ? null : v)),
  phone: emptyStringToNull,
  mobile: emptyStringToNull,
  companyName: emptyStringToNull,
  industry: emptyStringToNull,
  website: emptyStringToNull,
  street: emptyStringToNull,
  city: emptyStringToNull,
  state: emptyStringToNull,
  zipCode: emptyStringToNull,
  country: emptyStringToNull,
  status: z.enum(["new", "contacting", "engaged", "qualified", "unqualified"]).default("new"),
  source: emptyStringToNull,
  rating: emptyStringToNull,
  notes: emptyStringToNull,
});

export async function getLeads() {
  const db = await getDb();
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  return await db.select().from(leads).orderBy(desc(leads.createdAt));
}

export async function createLead(formData: FormData) {
  const db = await getDb();
  try {
    const session = await auth();
    if (!session?.user) throw new Error("Unauthorized");

    const rawData = Object.fromEntries(formData.entries());
    const validatedData = leadSchema.parse(rawData);

    await db.insert(leads).values({
      ...validatedData,
      ownerId: session.user.id,
    });

    revalidatePath("/dashboard/leads");
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error("Validation error:", error.errors);
      return { success: false, error: error.errors[0].message };
    }
    console.error("Error creating lead:", error);
    let errorMsg = "Failed to create lead";
    if (error instanceof Error) {
      errorMsg = error.message;
      if ("cause" in error && error.cause instanceof Error) {
        errorMsg += ` | Cause: ${error.cause.message}`;
      } else if ("cause" in error && typeof error.cause === "object" && error.cause !== null) {
        // NeonDbError stores stuff in cause directly
        errorMsg += ` | Cause: ${(error.cause as any).message || JSON.stringify(error.cause)}`;
      }
    }
    return { success: false, error: errorMsg };
  }
}

export async function deleteLead(id: string) {
  const db = await getDb();
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  await db.delete(leads).where(eq(leads.id, id));
  revalidatePath("/dashboard/leads");
}

"use server";

import { db } from "@/db";
import { leads } from "@/db/schema";
import { auth } from "@/auth";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const emptyStringToNull = z.union([z.string(), z.null(), z.undefined()]).transform(v => !v ? null : v);

const leadSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  jobTitle: emptyStringToNull,
  email: z.union([z.string().email("Invalid email address"), z.literal(""), z.null(), z.undefined()]).transform(v => !v ? null : v),
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
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  return await db.select().from(leads).orderBy(desc(leads.createdAt));
}

export async function createLead(formData: FormData) {
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
    return { success: false, error: error instanceof Error ? error.message : "Failed to create lead" };
  }
}

export async function deleteLead(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");

  await db.delete(leads).where(eq(leads.id, id));
  revalidatePath("/dashboard/leads");
}

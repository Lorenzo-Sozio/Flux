"use server";

import { db } from "@/db";
import { leads } from "@/db/schema";
import { auth } from "@/auth";
import { eq, desc } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const leadSchema = z.object({
  firstName: z.string().min(1, "Il nome è obbligatorio"),
  lastName: z.string().min(1, "Il cognome è obbligatorio"),
  email: z.string().email("Email non valida").optional().or(z.literal("")),
  phone: z.string().optional().or(z.literal("")),
  companyName: z.string().optional().or(z.literal("")),
  status: z.enum(["new", "contacted", "qualified", "lost"]).default("new"),
  source: z.string().optional().or(z.literal("")),
});

export async function getLeads() {
  const session = await auth();
  if (!session?.user) throw new Error("Non autorizzato");

  return await db.select().from(leads).orderBy(desc(leads.createdAt));
}

export async function createLead(formData: FormData) {
  const session = await auth();
  if (!session?.user) throw new Error("Non autorizzato");

  const rawData = {
    firstName: formData.get("firstName") as string,
    lastName: formData.get("lastName") as string,
    email: formData.get("email") as string,
    phone: formData.get("phone") as string,
    companyName: formData.get("companyName") as string,
    status: (formData.get("status") as string) || "new",
    source: formData.get("source") as string,
  };

  const validatedData = leadSchema.parse(rawData);

  await db.insert(leads).values({
    ...validatedData,
    ownerId: session.user.id,
  });

  revalidatePath("/dashboard/leads");
}

export async function deleteLead(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error("Non autorizzato");

  await db.delete(leads).where(eq(leads.id, id));
  revalidatePath("/dashboard/leads");
}

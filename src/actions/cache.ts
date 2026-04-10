"use server";

import { revalidatePath } from "next/cache";

export async function revalidateDealPage(dealId: string) {
  revalidatePath(`/dashboard/pipeline/${dealId}`);
}

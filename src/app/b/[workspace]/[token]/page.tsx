import { notFound } from "next/navigation";

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { loadBookingPage } from "@/lib/booking-public";

import { BookingClient } from "./booking-client";

// Public, and never cached: the free slots are the whole content, and they change.
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ workspace: string; token: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { workspace, token } = await params;
  const page = await loadBookingPage(workspace, token).catch(() => null);
  const t = await getTranslations("booking");
  // Not indexed: a booking page is shared on purpose, not found by searching.
  return { title: page ? t("pageTitle", { name: page.ownerName }) : t("closedTitle"), robots: { index: false } };
}

/**
 * A person's public booking page (src/lib/booking-public.ts): their free slots over the
 * next days, and a form to take one.
 */
export default async function BookingPage({ params }: Props) {
  const { workspace, token } = await params;
  const page = await loadBookingPage(workspace, token).catch(() => null);
  if (!page) notFound();
  return <BookingClient workspace={workspace} token={token} page={page} />;
}

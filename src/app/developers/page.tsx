import type { Metadata } from "next";

import { ApiDocsView } from "@/components/api-docs/api-docs-view";
import { PUBLIC_API_GROUPS } from "@/lib/api-docs/public-api";

export const metadata: Metadata = {
  title: "API — Flux CRM",
  description: "Le API di Flux CRM per chi integra: lettura, scrittura, permessi delle chiavi.",
};

/**
 * The API reference for whoever received a key (§13.11). It used to exist only behind the
 * staff login at /admin/api-docs, so the person holding the key could not read what it did.
 * The same entries as the staff page, minus the internal routes.
 */
export default function DevelopersPage() {
  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-8">
      <ApiDocsView groups={PUBLIC_API_GROUPS} variant="public" />
    </main>
  );
}

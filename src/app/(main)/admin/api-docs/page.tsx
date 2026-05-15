import type { Metadata } from "next";

import { ApiDocsClient } from "./_components/api-docs-client";

export const metadata: Metadata = { title: "API Documentation — Flux CRM" };

export default function ApiDocsPage() {
  return <ApiDocsClient />;
}

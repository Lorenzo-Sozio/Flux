"use client";

import { useRouter } from "next/navigation";

import { CampaignModal } from "@/components/crm/campaign-modal";

interface Template {
  id: string;
  name: string;
  subject: string;
  category: string;
}

export function NewCampaignButton({ templates }: { templates: Template[] }) {
  const router = useRouter();
  return <CampaignModal templates={templates} onSuccess={() => router.refresh()} />;
}

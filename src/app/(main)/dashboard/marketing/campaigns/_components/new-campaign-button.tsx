"use client";

import { CampaignModal } from "@/components/crm/campaign-modal";

interface Template {
  id: string;
  name: string;
  subject: string;
  category: string;
}

export function NewCampaignButton({ templates }: { templates: Template[] }) {
  return <CampaignModal templates={templates} openOnNew />;
}

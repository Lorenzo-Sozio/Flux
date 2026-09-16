"use client";

import { useState } from "react";

import { TrashIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteMarketingCampaign } from "@/actions/marketing";
import { Button } from "@/components/ui/button";

interface CampaignDeleteButtonProps {
  campaignId: string;
}

export function CampaignDeleteButton({ campaignId }: CampaignDeleteButtonProps) {
  const t = useTranslations("marketing.campaigns.deleteButton");
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm(t("confirm"))) return;

    setLoading(true);
    try {
      await deleteMarketingCampaign(campaignId);
      toast.success(t("success"));
    } catch (error) {
      toast.error(t("failed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-destructive"
      onClick={handleDelete}
      disabled={loading}
    >
      <TrashIcon className="h-4 w-4" />
    </Button>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import { TrashIcon } from "lucide-react";
import { deleteMarketingCampaign } from "@/actions/marketing";
import { toast } from "sonner";
import { useState } from "react";

interface CampaignDeleteButtonProps {
  campaignId: string;
}

export function CampaignDeleteButton({ campaignId }: CampaignDeleteButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this campaign?")) return;
    
    setLoading(true);
    try {
      await deleteMarketingCampaign(campaignId);
      toast.success("Campaign deleted successfully");
    } catch (error) {
      toast.error("Failed to delete campaign");
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

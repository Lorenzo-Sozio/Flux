"use client";

import { SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { ConvertLeadDialog } from "@/components/crm/convert-lead-dialog";
import { Button } from "@/components/ui/button";

interface ConvertLeadButtonProps {
  leadId: string;
  leadName: string;
  companyName?: string | null;
  activityCount: number;
  taskCount: number;
}

export function ConvertLeadButton({ leadId, leadName, companyName, activityCount, taskCount }: ConvertLeadButtonProps) {
  const t = useTranslations("leads");
  return (
    <ConvertLeadDialog
      lead={{ id: leadId, name: leadName, companyName }}
      activityCount={activityCount}
      taskCount={taskCount}
      trigger={
        // The page's key action while the lead is open, so it is the one filled button in the
        // hero — and the same height as the outlined Call and Email beside it.
        <Button size="sm">
          <SparklesIcon className="size-3.5" aria-hidden />
          {t("convertLead")}
        </Button>
      }
    />
  );
}

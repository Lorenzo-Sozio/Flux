"use client";

import { useState } from "react";

import { TrashIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { deleteEmailTemplate } from "@/actions/marketing";
import { Button } from "@/components/ui/button";

interface TemplateDeleteButtonProps {
  templateId: string;
}

export function TemplateDeleteButton({ templateId }: TemplateDeleteButtonProps) {
  const t = useTranslations("marketing.templates.deleteButton");
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm(t("confirm"))) return;

    setLoading(true);
    try {
      await deleteEmailTemplate(templateId);
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
      className="h-8 w-8 text-destructive hover:bg-destructive/10"
      onClick={handleDelete}
      disabled={loading}
    >
      <TrashIcon className="h-4 w-4" />
    </Button>
  );
}

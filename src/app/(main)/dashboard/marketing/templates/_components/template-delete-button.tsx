"use client";

import { useState } from "react";

import { TrashIcon } from "lucide-react";
import { toast } from "sonner";

import { deleteEmailTemplate } from "@/actions/marketing";
import { Button } from "@/components/ui/button";

interface TemplateDeleteButtonProps {
  templateId: string;
}

export function TemplateDeleteButton({ templateId }: TemplateDeleteButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm("Are you sure you want to delete this template?")) return;

    setLoading(true);
    try {
      await deleteEmailTemplate(templateId);
      toast.success("Template deleted successfully");
    } catch (error) {
      toast.error("Failed to delete template");
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

"use client";

import { useState } from "react";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { useOpenOnNew } from "@/hooks/use-open-on-new";

import { CreateTicketModal } from "./create-ticket-modal";

interface CreateTicketButtonProps {
  contactId?: string;
  companyId?: string;
  variant?: "default" | "outline" | "ghost" | "destructive";
  /** Open when the page is reached with ?new=true. One per page. */
  openOnNew?: boolean;
}

export function CreateTicketButton({
  contactId,
  companyId,
  variant = "default",
  openOnNew = false,
}: CreateTicketButtonProps) {
  const t = useTranslations("support.tickets");
  const [open, setOpen] = useState(false);
  useOpenOnNew(openOnNew, setOpen);

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)} className="gap-2">
        <Plus className="h-4 w-4" />
        {t("newTicket")}
      </Button>

      <CreateTicketModal open={open} onOpenChange={setOpen} defaultContactId={contactId} defaultCompanyId={companyId} />
    </>
  );
}

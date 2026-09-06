"use client";

import { useState } from "react";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

import { CreateTicketModal } from "./create-ticket-modal";

interface CreateTicketButtonProps {
  contactId?: string;
  companyId?: string;
  variant?: "default" | "outline" | "ghost" | "destructive";
}

export function CreateTicketButton({ contactId, companyId, variant = "default" }: CreateTicketButtonProps) {
  const t = useTranslations("support.tickets");
  const [open, setOpen] = useState(false);

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

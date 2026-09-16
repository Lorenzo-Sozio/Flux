"use client";

import React, { useState } from "react";

import { useTranslations } from "next-intl";

import { revalidateDealPage } from "@/actions/cache";
import { CreateQuoteModal } from "@/components/crm/create-quote-modal";
import { Button } from "@/components/ui/button";

interface CreateQuoteButtonProps {
  dealId: string;
  companyId: string;
  contactId?: string;
  products: Array<{ id: string; name: string; price: string }>;
}

export function CreateQuoteButton({ dealId, companyId, contactId, products }: CreateQuoteButtonProps) {
  const t = useTranslations("quotes.createModal");
  const [open, setOpen] = useState(false);

  const handleSuccess = async (quoteId: string) => {
    setOpen(false);
    // Call server action to revalidate the page
    await revalidateDealPage(dealId);
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        {t("addQuote")}
      </Button>
      <CreateQuoteModal
        open={open}
        onOpenChange={setOpen}
        dealId={dealId}
        companyId={companyId}
        contactId={contactId}
        products={products}
        onSuccess={handleSuccess}
      />
    </>
  );
}

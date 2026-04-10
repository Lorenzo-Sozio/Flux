"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { CreateQuoteModal } from "@/components/crm/create-quote-modal";
import { revalidateDealPage } from "@/actions/cache";

interface CreateQuoteButtonProps {
  dealId: string;
  companyId: string;
  contactId?: string;
  products: Array<{ id: string; name: string; price: string }>;
}

export function CreateQuoteButton({
  dealId,
  companyId,
  contactId,
  products,
}: CreateQuoteButtonProps) {
  const [open, setOpen] = useState(false);

  const handleSuccess = async (quoteId: string) => {
    setOpen(false);
    // Call server action to revalidate the page
    await revalidateDealPage(dealId);
  };

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
      >
        Add Quote
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

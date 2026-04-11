"use client";

import { useRouter } from "next/navigation";
import { PencilIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DealModal } from "@/components/crm/deal-modal";

export function DealEditButton({
  deal,
  stages,
  companies,
  contacts,
}: {
  deal: any;
  stages: any[];
  companies: any[];
  contacts: any[];
}) {
  const router = useRouter();

  return (
    <DealModal
      deal={deal}
      stages={stages}
      companies={companies}
      contacts={contacts}
      onSuccess={() => router.refresh()}
    >
      <Button variant="outline" size="sm" className="gap-1.5">
        <PencilIcon className="h-3.5 w-3.5" />
        Edit
      </Button>
    </DealModal>
  );
}

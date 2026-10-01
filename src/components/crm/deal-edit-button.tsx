"use client";

import { useRouter } from "next/navigation";

import { PencilIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { DealModal } from "@/components/crm/deal-modal";
import { Button } from "@/components/ui/button";

export function DealEditButton({
  deal,
  stages,
  companies,
  contacts,
}: {
  deal: any;
  stages: any[];
  /** Left out, the dialog loads them when it opens. */
  companies?: { id: string; name: string }[];
  contacts?: { id: string; firstName: string | null; lastName: string | null }[];
}) {
  const router = useRouter();
  const tc = useTranslations("common");

  return (
    <DealModal deal={deal} stages={stages} companies={companies} contacts={contacts} onSuccess={() => router.refresh()}>
      <Button variant="outline" size="sm" className="gap-1.5">
        <PencilIcon className="h-3.5 w-3.5" />
        {tc("edit")}
      </Button>
    </DealModal>
  );
}

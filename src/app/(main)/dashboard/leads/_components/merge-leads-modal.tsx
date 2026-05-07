"use client";

import { useTranslations } from "next-intl";
import { MergeEntityModal, type MergeField } from "@/components/crm/merge-entity-modal";
import { getLeadForMerge, mergeLeads } from "@/actions/crm";

type LeadData = NonNullable<Awaited<ReturnType<typeof getLeadForMerge>>>;

interface Props {
  keepId: string;
  mergeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MergeLeadsModal({ keepId, mergeId, open, onOpenChange }: Props) {
  const t = useTranslations("merge.leads");

  const FIELDS: MergeField<LeadData>[] = [
    { key: "email", label: t("fieldEmail") },
    { key: "phone", label: t("fieldPhone") },
    { key: "mobile", label: t("fieldMobile") },
    { key: "jobTitle", label: t("fieldJobTitle") },
    { key: "companyName", label: t("fieldCompany") },
    { key: "industry", label: t("fieldIndustry") },
    { key: "website", label: t("fieldWebsite") },
    { key: "source", label: t("fieldSource") },
    { key: "street", label: t("fieldStreet") },
    { key: "city", label: t("fieldCity") },
    { key: "state", label: t("fieldState") },
    { key: "zipCode", label: t("fieldZipCode") },
    { key: "country", label: t("fieldCountry") },
    { key: "notes", label: t("fieldNotes") },
  ];

  return (
    <MergeEntityModal<LeadData>
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      keepId={keepId}
      mergeId={mergeId}
      fields={FIELDS}
      fetchEntity={getLeadForMerge}
      onMerge={mergeLeads}
      getDisplayName={(l) => `${l.firstName} ${l.lastName}`}
      reassignedDescription={(keep, merge) => (
        <>
          {t("reassignedStart")}{" "}
          <strong>{merge.firstName} {merge.lastName}</strong>{" "}
          {t("reassignedMiddle")}{" "}
          <strong>{keep.firstName} {keep.lastName}</strong>
          {t("reassignedEnd")}
        </>
      )}
    />
  );
}

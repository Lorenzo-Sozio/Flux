"use client";

import { useTranslations } from "next-intl";

import { getCompanyForMerge, mergeCompanies } from "@/actions/crm";
import { MergeEntityModal, type MergeField } from "@/components/crm/merge-entity-modal";

type CompanyData = NonNullable<Awaited<ReturnType<typeof getCompanyForMerge>>>;

interface Props {
  keepId: string;
  mergeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MergeCompaniesModal({ keepId, mergeId, open, onOpenChange }: Props) {
  const t = useTranslations("merge.companies");

  const FIELDS: MergeField<CompanyData>[] = [
    { key: "mainEmail", label: t("fieldEmail") },
    { key: "mainPhone", label: t("fieldPhone") },
    { key: "website", label: t("fieldWebsite") },
    { key: "industry", label: t("fieldIndustry") },
    { key: "linkedinUrl", label: t("fieldLinkedin") },
    { key: "source", label: t("fieldSource") },
    { key: "vatNumber", label: t("fieldVatNumber") },
    { key: "sdiCode", label: t("fieldSdiCode") },
    { key: "street", label: t("fieldStreet") },
    { key: "city", label: t("fieldCity") },
    { key: "state", label: t("fieldState") },
    { key: "zipCode", label: t("fieldZipCode") },
    { key: "country", label: t("fieldCountry") },
    { key: "description", label: t("fieldDescription") },
  ];

  return (
    <MergeEntityModal<CompanyData>
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      keepId={keepId}
      mergeId={mergeId}
      fields={FIELDS}
      fetchEntity={getCompanyForMerge}
      onMerge={mergeCompanies}
      getDisplayName={(c) => c.name}
      reassignedDescription={(keep, merge) => (
        <>
          {t("reassignedStart")} <strong>{merge.name}</strong> {t("reassignedMiddle")} <strong>{keep.name}</strong>
          {t("reassignedEnd")}
        </>
      )}
    />
  );
}

"use client";

import { useTranslations } from "next-intl";
import { MergeEntityModal, type MergeField } from "@/components/crm/merge-entity-modal";
import { getContactForMerge, mergeContacts } from "@/actions/crm";

type ContactData = NonNullable<Awaited<ReturnType<typeof getContactForMerge>>>;

interface Props {
  keepId: string;
  mergeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MergeContactsModal({ keepId, mergeId, open, onOpenChange }: Props) {
  const t = useTranslations("merge.contacts");

  const FIELDS: MergeField<ContactData>[] = [
    { key: "email", label: t("fieldEmail") },
    { key: "phone", label: t("fieldPhone") },
    { key: "mobile", label: t("fieldMobile") },
    { key: "jobTitle", label: t("fieldJobTitle") },
    { key: "department", label: t("fieldDepartment") },
    { key: "linkedinUrl", label: t("fieldLinkedin") },
    {
      key: "companyId",
      label: t("fieldCompany"),
      display: (c) => c.company?.name ?? "—",
      hasValue: (c) => !!c.company,
      mergeValue: (c) => c.companyId,
    },
    { key: "source", label: t("fieldSource") },
    { key: "street", label: t("fieldStreet") },
    { key: "city", label: t("fieldCity") },
    { key: "state", label: t("fieldState") },
    { key: "zipCode", label: t("fieldZipCode") },
    { key: "country", label: t("fieldCountry") },
    { key: "notes", label: t("fieldNotes") },
  ];

  return (
    <MergeEntityModal<ContactData>
      open={open}
      onOpenChange={onOpenChange}
      title={t("title")}
      keepId={keepId}
      mergeId={mergeId}
      fields={FIELDS}
      fetchEntity={getContactForMerge}
      onMerge={mergeContacts}
      getDisplayName={(c) => `${c.firstName} ${c.lastName}`}
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

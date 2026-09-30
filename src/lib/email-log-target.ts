/**
 * Which record an email sent from a record page is logged on.
 *
 * ⚠️⚠️ It was guessed from the fields — "has a company name, so it is a lead" — and a lead
 * with no company was logged as a contact: its id went into `activity.contact_id`, the
 * foreign key refused it, and the person saw an error for an email that had already gone,
 * and sent it again. The page says which record it is; when it does not, only a lead
 * carries `isConverted`.
 */
export function emailLogTarget(
  entity: { id: string; isConverted?: boolean | null },
  entityType?: "lead" | "contact" | "company",
): { leadId?: string; contactId?: string; companyId?: string } {
  // No record of the person's own (a deal's contact seen from the work list): the deal logs it.
  if (!entity.id) return {};
  // A company is only ever said: written to its own address, it has nothing to be guessed from.
  if (entityType === "company") return { companyId: entity.id };
  const kind = entityType ?? ("isConverted" in entity ? "lead" : "contact");
  return kind === "lead" ? { leadId: entity.id } : { contactId: entity.id };
}

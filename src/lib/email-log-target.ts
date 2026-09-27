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
  entityType?: "lead" | "contact",
): { leadId?: string; contactId?: string } {
  const kind = entityType ?? ("isConverted" in entity ? "lead" : "contact");
  return kind === "lead" ? { leadId: entity.id } : { contactId: entity.id };
}

/**
 * A list of addresses as a person types it in a Cc or Bcc field: separated by commas,
 * semicolons or spaces, with or without a display name ("Anna Rossi <anna@x.it>").
 *
 * Pure, and used on both sides: the dialog says which address is wrong before sending, and
 * the server refuses the same ones — a browser is not where a rule is kept.
 */

/** Deliberately plain: the provider is the final judge; this only catches what is obviously not an address. */
const ADDRESS = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;

/** More copies than this is a mailing, not an email from a record. */
export const MAX_COPIES = 20;

export interface AddressList {
  /** Lower-cased, de-duplicated, in the order typed. */
  addresses: string[];
  /** What was typed and is not an address. */
  invalid: string[];
}

export function parseAddressList(input: string | null | undefined): AddressList {
  const addresses: string[] = [];
  const invalid: string[] = [];
  const parts = (input ?? "")
    // "Name <addr>" keeps only the address; a name may contain spaces, the address may not.
    .replace(/[^,;<>]*<([^>]*)>/g, " $1 ")
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    const address = part.toLowerCase();
    if (!ADDRESS.test(address)) invalid.push(part);
    else if (!addresses.includes(address)) addresses.push(address);
  }
  return { addresses, invalid };
}

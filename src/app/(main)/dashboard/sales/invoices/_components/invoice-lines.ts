/**
 * Invoice lines as the editors hold them: text while typed, numbers when read.
 * No "use client" here, so the server page can build the first lines too.
 */

export interface EditableLine {
  key: string;
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent: string;
  taxPercent: string;
  nature: string;
}

export interface CatalogueProduct {
  id: string;
  name: string;
  sku: string | null;
  price: number;
  taxPercent: number;
}

/** A typed number, accepting the Italian decimal comma. */
export const num = (v: string) => Number(v.replace(",", ".")) || 0;

let counter = 0;
export function blankLine(): EditableLine {
  counter += 1;
  return {
    key: `n${Date.now()}-${counter}`,
    productId: null,
    description: "",
    quantity: "1",
    unitPrice: "0",
    discountPercent: "0",
    taxPercent: "22",
    nature: "",
  };
}

/** Lines as the rules and the totals read them. */
export function asDraftLines(lines: EditableLine[]) {
  return lines.map((l) => ({
    productId: l.productId,
    description: l.description,
    quantity: num(l.quantity),
    unitPrice: num(l.unitPrice),
    discountPercent: num(l.discountPercent),
    taxPercent: num(l.taxPercent),
    nature: l.nature || null,
  }));
}

/** A line with numbers, as the editor's text fields hold it. */
export function editableFields(l: {
  productId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPercent?: number | null;
  taxPercent: number;
  nature?: string | null;
}): Omit<EditableLine, "key"> {
  return {
    productId: l.productId ?? null,
    description: l.description,
    quantity: String(l.quantity),
    unitPrice: String(l.unitPrice),
    discountPercent: String(l.discountPercent ?? 0),
    taxPercent: String(l.taxPercent),
    nature: l.nature ?? "",
  };
}

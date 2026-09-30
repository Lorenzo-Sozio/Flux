/**
 * Where an order is on its way (migration 0071): the day the customer was told to expect it, who
 * carries it and the code to follow it. Read by `setOrderShipping` and by the order emails.
 */
const SHIPPING_TEXT_MAX = 120;

function isCalendarDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const time = Date.parse(`${day}T00:00:00Z`);
  // "2026-13-01" does not parse; "2026-02-31" parses to 3 March, and would reach the customer as a
  // date that does not exist.
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === day;
}

/** What `setOrderShipping` accepts: a real calendar day or none, and two short texts. */
export function cleanShipping(input: {
  expectedDeliveryDate?: string | null;
  carrier?: string | null;
  trackingCode?: string | null;
}): { expectedDeliveryDate: string | null; carrier: string | null; trackingCode: string | null } | null {
  const day = input.expectedDeliveryDate?.trim() || null;
  if (day && !isCalendarDay(day)) return null;
  const text = (v: string | null | undefined) => v?.trim().slice(0, SHIPPING_TEXT_MAX) || null;
  return { expectedDeliveryDate: day, carrier: text(input.carrier), trackingCode: text(input.trackingCode) };
}

import { getOrderFormData } from "@/actions/orders";

import { NewOrderForm } from "./_components/new-order-form";

/**
 * Loads the form's customers and products on the server, so the pickers are full
 * when the page first draws instead of after a second round trip from the browser.
 *
 * A failed load renders the form anyway with nothing in the pickers, and the form
 * says why — the same thing the client-side load did, rather than a crashed page.
 */
export default async function NewOrderPage() {
  const data = await getOrderFormData().catch(() => null);
  return <NewOrderForm initialData={data} />;
}

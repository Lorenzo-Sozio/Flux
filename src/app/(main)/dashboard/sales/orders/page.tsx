import { getOrderStats, getOrders } from "@/actions/orders";

import { OrdersClient } from "./_components/orders-client";

export default async function OrdersPage() {
  // The product catalogue used to be loaded here for the creation dialog. The form
  // is its own page now and fetches what it needs, so the list stops paying for it.
  const [orderList, stats] = await Promise.all([getOrders(), getOrderStats()]);

  return <OrdersClient orders={orderList} stats={stats} />;
}

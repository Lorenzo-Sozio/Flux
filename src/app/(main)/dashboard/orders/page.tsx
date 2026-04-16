import { getOrders, getOrderStats } from "@/actions/orders";
import { getProducts } from "@/actions/products";
import { OrdersClient } from "./_components/orders-client";

export default async function OrdersPage() {
  const [orderList, stats, productList] = await Promise.all([
    getOrders(),
    getOrderStats(),
    getProducts(),
  ]);

  return <OrdersClient orders={orderList} stats={stats} products={productList} />;
}

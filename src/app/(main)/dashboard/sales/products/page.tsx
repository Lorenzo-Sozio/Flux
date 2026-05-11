import { getProducts } from "@/actions/products";
import { ProductsClient } from "./_components/products-client";

export default async function ProductsPage() {
  const products = await getProducts();
  return <ProductsClient products={products} />;
}

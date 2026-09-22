import { notFound } from "next/navigation";

import { asc, eq } from "drizzle-orm";

import { getCompaniesForSelect } from "@/actions/crm";
import { getPriceList } from "@/actions/price-lists";
import { getProductsForSelect } from "@/actions/products";
import { RecordVisit } from "@/components/crm/record-visit";
import { companies } from "@/db/schema";
import { hasCapability } from "@/lib/auth-guard";
import { requirePageCapability } from "@/lib/page-guard";
import { getDb } from "@/lib/tenant-context";

import { PriceListDetail } from "./_components/price-list-detail";

export default async function PriceListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageCapability("record:read", `/dashboard/sales/price-lists/${id}`);

  const data = await getPriceList(id);
  if (!data) notFound();

  const db = await getDb();
  const [products, allCompanies, assigned, canManage] = await Promise.all([
    getProductsForSelect(),
    getCompaniesForSelect(),
    // ⚠️ Read here rather than added to `getPriceList`, which every caller of the
    // list's rules would then pay for: the pricing path wants the percentage and
    // the overrides, and has no use for who is on the list.
    db
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(eq(companies.priceListId, id))
      .orderBy(asc(companies.name)),
    hasCapability("product:manage"),
  ]);

  return (
    <div className="space-y-6">
      <RecordVisit type="priceList" id={data.list.id} label={data.list.name} />
      <PriceListDetail
        list={{
          id: data.list.id,
          name: data.list.name,
          description: data.list.description,
          adjustmentPercent: data.list.adjustmentPercent,
          isActive: data.list.isActive,
        }}
        items={data.items}
        products={products}
        assigned={assigned}
        allCompanies={allCompanies}
        canManage={canManage}
      />
    </div>
  );
}

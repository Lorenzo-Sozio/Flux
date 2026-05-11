import { notFound } from "next/navigation";
import { getTenant, listTenantMembers } from "@/actions/tenants";
import { MembersPanel } from "./_components/members-panel";

interface Props {
  params: Promise<{ subdomain: string }>;
}

export default async function TenantDetailPage({ params }: Props) {
  const { subdomain } = await params;

  let tenant: Awaited<ReturnType<typeof getTenant>>;
  let members: Awaited<ReturnType<typeof listTenantMembers>>;

  try {
    [tenant, members] = await Promise.all([
      getTenant(subdomain),
      listTenantMembers(subdomain),
    ]);
  } catch {
    return notFound();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{tenant.name}</h1>
        <p className="text-sm text-gray-500 mt-1">
          <code className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs">
            {subdomain}
          </code>
        </p>
      </div>

      <MembersPanel subdomain={subdomain} initialMembers={members} />
    </div>
  );
}

import Link from "next/link";

export default function TenantNotFound() {
  return (
    <div className="min-h-screen bg-slate-50 py-24">
      <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-lg">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">
          Tenant not found
        </p>
        <h1 className="mt-4 text-4xl font-semibold text-slate-900">Page not found</h1>
        <p className="mt-4 text-sm leading-7 text-slate-600">
          The tenant you requested does not exist, or the subdomain is not registered.
          Please check the URL or create the tenant from the admin panel.
        </p>
        <Link
          href="/admin/tenants"
          className="mt-8 inline-flex rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
        >
          Manage tenants
        </Link>
      </div>
    </div>
  );
}

import { notFound, redirect } from "next/navigation";
import { getTenantBySubdomain } from "@/lib/get-tenant";
import { auth } from "@/auth";
import { platformDb } from "@/db";
import { tenantMembers } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { BarChart3, Users, Target, FileText, Zap, Shield, Lock } from "lucide-react";

interface TenantPageProps {
  params: Promise<{ subdomain: string }>;
}

const FEATURES = [
  { icon: Users, label: "Contacts & Companies" },
  { icon: Target, label: "Pipeline & Deals" },
  { icon: FileText, label: "Quotes & Finance" },
  { icon: BarChart3, label: "Reports & Analytics" },
  { icon: Zap, label: "Automation Rules" },
  { icon: Shield, label: "Role-based Access" },
];

export default async function TenantPage({ params }: TenantPageProps) {
  const { subdomain } = await params;

  // Resolve tenant first (cached, 5-min TTL) — notFound() if invalid subdomain.
  let tenant: Awaited<ReturnType<typeof getTenantBySubdomain>> = null;
  try {
    tenant = await getTenantBySubdomain(subdomain);
  } catch {
    // Platform DB unreachable — fall through to notFound()
  }
  if (!tenant) return notFound();

  const session = await auth();

  // Authenticated user: check membership and redirect or show unauthorized.
  if (session?.user?.id) {
    const [member] = await platformDb
      .select({ id: tenantMembers.id })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenant.id), eq(tenantMembers.userId, session.user.id)));

    if (member) {
      redirect("/dashboard/crm");
    }

    // Logged in but not a member of this workspace — show access-denied state.
    const settings = (() => {
      try { return tenant.settings ? JSON.parse(tenant.settings) : {}; } catch { return {}; }
    })();
    const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4 py-16">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-white text-4xl shadow-md ring-1 ring-slate-200">
            {settings.emoji ?? "🧩"}
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{tenant.name}</h1>
          <p className="mt-1 text-sm text-slate-500">{subdomain}.{rootDomain}</p>

          <div className="mt-8 rounded-3xl border border-red-100 bg-white px-8 py-8 shadow-lg">
            <Lock className="mx-auto mb-3 h-8 w-8 text-red-400" />
            <h2 className="text-lg font-semibold text-slate-900">Access Denied</h2>
            <p className="mt-2 text-sm text-slate-500">
              You&apos;re signed in as <strong>{session.user.email}</strong> but you&apos;re not a member of this workspace.
            </p>
            <p className="mt-3 text-xs text-slate-400">
              Contact the workspace owner to request access.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const settings = (() => {
    try { return tenant.settings ? JSON.parse(tenant.settings) : {}; } catch { return {}; }
  })();

  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "localhost:3000";
  const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
  const loginUrl = `${protocol}://${subdomain}.${rootDomain}/auth/v1/login`;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 px-4 py-16">
      <div className="w-full max-w-md">
        {/* Logo + tenant identity */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-white text-4xl shadow-md ring-1 ring-slate-200">
            {settings.emoji ?? "🧩"}
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{tenant.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {subdomain}.{rootDomain}
          </p>
        </div>

        {/* Sign-in card */}
        <div className="rounded-3xl border border-slate-200 bg-white px-8 py-8 shadow-lg">
          <p className="text-center text-sm font-medium text-slate-500">
            Welcome to your workspace
          </p>
          <h2 className="mt-1 text-center text-xl font-semibold text-slate-900">
            Sign in to continue
          </h2>

          <a
            href={loginUrl}
            className="mt-6 flex w-full items-center justify-center rounded-2xl bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
          >
            Sign in to {tenant.name}
          </a>

          <p className="mt-4 text-center text-xs text-slate-400">
            You&apos;ll be redirected to the secure login page.
          </p>
        </div>

        {/* Feature grid */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {FEATURES.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex flex-col items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-4 text-center shadow-sm"
            >
              <Icon className="h-5 w-5 text-slate-400" />
              <span className="text-xs font-medium text-slate-600">{label}</span>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-slate-400">
          Powered by{" "}
          <span className="font-semibold text-slate-600">Flux CRM</span>
        </p>
      </div>
    </div>
  );
}

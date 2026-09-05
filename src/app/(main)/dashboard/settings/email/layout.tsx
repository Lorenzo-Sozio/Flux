import { requirePageCapability } from "@/lib/page-guard";

/**
 * The guard for a page that cannot hold one itself.
 *
 * The email settings screen is a client component, so it cannot call
 * `requirePageCapability` — and it had no guard at all. Anyone with a session
 * reached it. The actions underneath now refuse without `settings:manage`, so
 * nothing leaked, but the reader got a raw error where every other settings page
 * redirects and says why.
 *
 * A layout is a server component, which is where the check belongs.
 */
export default async function EmailSettingsLayout({ children }: { children: React.ReactNode }) {
  await requirePageCapability("settings:manage", "/dashboard/settings/email");
  return children;
}

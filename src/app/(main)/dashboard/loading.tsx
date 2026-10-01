/**
 * The dashboard's loading skeleton.
 *
 * Every page is a server component that awaits its queries before producing a pixel, and there was
 * no `loading.tsx` anywhere in the app: clicking a sidebar item left the previous page on screen,
 * motionless, for as long as the queries took — which reads as a frozen application rather than a
 * slow one (audit rilievo B-07). Sections and record pages have their own now
 * (src/components/crm/page-skeletons.tsx); this one covers the rest.
 */
import { ListPageSkeleton } from "@/components/crm/page-skeletons";

export default function DashboardLoading() {
  return <ListPageSkeleton />;
}

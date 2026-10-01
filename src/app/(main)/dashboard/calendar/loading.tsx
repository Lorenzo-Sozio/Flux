import { CalendarSkeleton } from "@/components/crm/page-skeletons";

/** The calendar, while it loads: its grid, not a table. See src/components/crm/page-skeletons.tsx. */
export default function Loading() {
  return <CalendarSkeleton />;
}

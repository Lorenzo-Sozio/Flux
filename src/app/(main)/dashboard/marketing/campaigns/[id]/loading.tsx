import { RecordPageSkeleton } from "@/components/crm/page-skeletons";

/** A record's page, while it loads: its own skeleton, so a list → record tap shows the record's shape at once. See src/components/crm/page-skeletons.tsx. */
export default function Loading() {
  return <RecordPageSkeleton />;
}

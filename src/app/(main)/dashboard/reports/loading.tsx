import { ListPageSkeleton } from "@/components/crm/page-skeletons";

/** This section's pages, while they load: their own boundary, so moving between them is answered at the tap. See src/components/crm/page-skeletons.tsx. */
export default function Loading() {
  return <ListPageSkeleton />;
}

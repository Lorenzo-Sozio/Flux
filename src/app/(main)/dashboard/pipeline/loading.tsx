import { BoardSkeleton } from "@/components/crm/page-skeletons";

/** The board, while it loads: its columns, not a table. See src/components/crm/page-skeletons.tsx. */
export default function Loading() {
  return <BoardSkeleton />;
}

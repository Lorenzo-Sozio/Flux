import { redirect } from "next/navigation";

export default function DefaultDashboardPage() {
  redirect("/dashboard/crm");
}

// ── Legacy imports kept for reference (unused) ────────────────────────────────
// import { ChartAreaInteractive } from "./_components/chart-area-interactive";
// import data from "./_components/data.json";
// import { SectionCards } from "./_components/section-cards";
/*
export default function Page() {
  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <SectionCards />
      <ChartAreaInteractive />
    </div>
  );
}*/
//
// The proposal sections table that stood here is gone. It was the only thing in
// the codebase using `@dnd-kit`, while every board a person actually drags —
// pipeline, tasks, tickets, the email builder — uses `@hello-pangea/dnd`. Two
// drag libraries in one bundle, one of them for a table no page rendered
// (audit rilievo M-09).

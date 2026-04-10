import { getAllSlas } from "@/actions/sla";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { SlaClient } from "./_components/sla-client";

export default async function SlaPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as { role?: string }).role;
  if (!["admin", "owner"].includes(role ?? "")) redirect("/dashboard");

  const slaList = await getAllSlas();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">SLA Management</h1>
        <p className="text-muted-foreground">
          Define response and resolution time targets for each ticket priority.
        </p>
      </div>
      <SlaClient slas={slaList} />
    </div>
  );
}

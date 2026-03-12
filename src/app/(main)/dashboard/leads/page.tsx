import { getLeads } from "./actions";
import { LeadsClient } from "./leads-client";

export default async function LeadsPage() {
  const leadsData = await getLeads();

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <LeadsClient initialLeads={leadsData} />
    </div>
  );
}

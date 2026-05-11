import { getAllUsers, getSalesTargets } from "@/actions/targets";

import { TargetsClient } from "./_components/targets-client";

export default async function TargetsPage() {
  const [allUsers, targets] = await Promise.all([getAllUsers(), getSalesTargets()]);

  return <TargetsClient users={allUsers} initialTargets={targets} />;
}

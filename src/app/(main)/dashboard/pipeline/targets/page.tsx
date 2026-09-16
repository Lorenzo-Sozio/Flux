import { getPipelineMembers } from "@/actions/pipeline-members";
import { getSalesTargets } from "@/actions/targets";
import { hasCapability } from "@/lib/auth-guard";
import { parsePipelineFilters } from "@/lib/pipeline-filters";

import { TargetsClient } from "./_components/targets-client";

/**
 * Targets per agent per month.
 *
 * ⚠️ It used to list people with `getAllUsersAction`, which needs `user:manage`, so
 * for anyone but an admin the page threw instead of showing their own targets.
 * Everyone who can read the pipeline can read targets; setting them is still
 * `settings:manage`, checked by the actions.
 */
export default async function TargetsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { owners } = parsePipelineFilters(await searchParams);
  const [members, targets, canManage] = await Promise.all([
    getPipelineMembers(),
    getSalesTargets(),
    hasCapability("settings:manage"),
  ]);

  // Targets belong to people, so "nobody" narrows to no rows rather than to all of them.
  const shown = owners.length ? members.filter((m) => owners.includes(m.id)) : members.filter((m) => !m.former);
  const users = shown.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role ?? "" }));

  return <TargetsClient users={users} initialTargets={targets} canManage={canManage} />;
}

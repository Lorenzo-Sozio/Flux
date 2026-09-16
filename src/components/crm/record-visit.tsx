"use client";

import { useEffect } from "react";

import { type EntityType, entityHref } from "@/lib/entities";
import { rememberRecord } from "@/lib/recent-records";

import { useWorkspaceScope } from "./workspace-scope";

/**
 * Put on a record's detail page: opening it is what makes it recent.
 *
 * ⚠️ `entities.test.ts` reads every `[id]/page.tsx` under the dashboard and fails
 * when one does not render this, so a new kind of record cannot quietly stay out
 * of the recents list.
 */
export function RecordVisit({
  type,
  id,
  label,
  sub,
}: {
  type: EntityType;
  id: string;
  label: string;
  sub?: string | null;
}) {
  const scope = useWorkspaceScope();
  useEffect(() => {
    if (!id || !label) return;
    rememberRecord(scope, { type, id, label, sub: sub ?? null, url: entityHref(type, id) });
  }, [scope, type, id, label, sub]);
  return null;
}

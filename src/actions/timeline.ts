"use server";

import { requireCapability } from "@/lib/auth-guard";
import { loadRecordTimeline, type TimelineScope } from "@/lib/record-timeline";
import { getDb } from "@/lib/tenant-context";

const TYPES = new Set(["company", "contact", "deal", "lead"]);

/** The next page of a record's timeline, before the last entry the page already shows. */
export async function loadMoreTimelineAction(scope: TimelineScope, beforeIso: string) {
  await requireCapability("record:read");
  if (!TYPES.has(scope.type) || typeof scope.id !== "string") throw new Error("Invalid timeline scope");
  const before = new Date(beforeIso);
  if (Number.isNaN(before.getTime())) throw new Error("Invalid cursor");
  return loadRecordTimeline(await getDb(), { type: scope.type, id: scope.id }, { before });
}

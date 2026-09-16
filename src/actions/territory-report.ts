"use server";

import { getTerritories } from "@/actions/territories";
import { requireCapability } from "@/lib/auth-guard";
import { PERIOD_OPTIONS } from "@/lib/pipeline-filters";
import { getDb } from "@/lib/tenant-context";
import { placeOfDeal, rollUp, type TerritoryRow } from "@/lib/territory-report";
import { dealsByPlace, leadsByPlace } from "@/lib/territory-report-queries";

export interface TerritoryReport {
  days: number;
  rows: TerritoryRow[];
  territoryCount: number;
}

/**
 * Leads and pipeline by territory, over the last `days` days, for some agents or all.
 *
 * Three statements whatever the size of the workspace: the territories, leads by
 * address, deals by address. See src/lib/territory-report.ts for the roll-up.
 */
export async function getTerritoryReport(days = 90, owners: string[] = []): Promise<TerritoryReport> {
  await requireCapability("report:read");
  const period = (PERIOD_OPTIONS as readonly number[]).includes(days) ? days : 90;
  const since = new Date(Date.now() - period * 86_400_000);
  const db = await getDb();

  const [rules, leadRows, dealRows] = await Promise.all([
    getTerritories(),
    leadsByPlace(db, since, owners),
    dealsByPlace(db, since, owners),
  ]);

  const rows = rollUp(
    [
      ...leadRows.map((r: Record<string, string | null>) => ({
        place: { country: r.country, state: r.state, zipCode: r.zipCode },
        figures: { openLeads: r.openLeads, newLeads: r.newLeads, convertedLeads: r.convertedLeads },
      })),
      ...dealRows.map((r: Record<string, string | null>) => ({
        place: placeOfDeal(
          { country: r.companyCountry, state: r.companyState, zipCode: r.companyZip },
          { country: r.contactCountry, state: r.contactState, zipCode: r.contactZip },
        ),
        figures: {
          openDeals: r.openDeals,
          openValue: r.openValue,
          wonDeals: r.wonDeals,
          wonValue: r.wonValue,
          lostDeals: r.lostDeals,
        },
      })),
    ],
    rules,
  );

  return { days: period, rows, territoryCount: rules.length };
}

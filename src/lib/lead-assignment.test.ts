/**
 * Who hears that a lead is theirs: the new owner, or the members of the group it was handed to —
 * never whoever made the assignment. A lead created already assigned, or handed to a group, used to
 * tell nobody.
 */
import { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { applyTenantMigrations } from "@/db/migrate-tenant";
import * as schema from "@/db/schema";

const db = drizzle(new PGlite(), { schema });

vi.mock("@/lib/tenant-context", () => ({ getDb: async () => db, getCurrentTenantId: async () => "t1" }));

const { announceLeadAssignment, announceLeadsAssigned, assignmentRecipients } = await import("./lead-assignment");

describe("⚠️⚠️ assignmentRecipients", () => {
  const members = ["anna", "bruno", "carla"];

  it("tells a new owner, and not the person who assigned it", () => {
    expect(
      assignmentRecipients({
        before: null,
        after: { ownerId: "anna", groupId: null },
        actorId: "bruno",
        groupMembers: [],
      }),
    ).toEqual({ owner: "anna", group: [] });
    expect(
      assignmentRecipients({
        before: null,
        after: { ownerId: "anna", groupId: null },
        actorId: "anna",
        groupMembers: [],
      }).owner,
    ).toBeNull();
  });

  it("tells nobody when the owner did not change", () => {
    const same = { ownerId: "anna", groupId: "g1" };
    expect(assignmentRecipients({ before: same, after: same, actorId: "bruno", groupMembers: members })).toEqual({
      owner: null,
      group: [],
    });
  });

  it("tells a group's members when the lead is handed to the group, except who handed it", () => {
    expect(
      assignmentRecipients({
        before: { ownerId: null, groupId: null },
        after: { ownerId: null, groupId: "g1" },
        actorId: "bruno",
        groupMembers: members,
      }),
    ).toEqual({ owner: null, group: ["anna", "carla"] });
  });

  it("tells the owner once, even when the owner is in the group too", () => {
    expect(
      assignmentRecipients({
        before: null,
        after: { ownerId: "anna", groupId: "g1" },
        actorId: null,
        groupMembers: members,
      }),
    ).toEqual({ owner: "anna", group: ["bruno", "carla"] });
  });
});

describe("⚠️ announceLeadAssignment, on a real database", () => {
  beforeAll(async () => {
    await applyTenantMigrations(db as never);
    for (const id of ["anna", "bruno", "carla"]) {
      await db.execute(sql`insert into "user" (id, email, name) values (${id}, ${`${id}@x.it`}, ${id})`);
    }
    await db.execute(sql`insert into user_group (id, name) values ('g1', 'Nord')`);
    await db.execute(
      sql`insert into user_group_member (group_id, user_id) values ('g1', 'anna'), ('g1', 'bruno'), ('g1', 'carla')`,
    );
  }, 120_000);

  beforeEach(async () => {
    await db.execute(sql`delete from notification`);
  });

  const bell = async () =>
    (await db.execute(sql`select user_id, type, title_key, link from notification order by user_id`)).rows as {
      user_id: string;
      type: string;
      title_key: string;
      link: string;
    }[];

  it("writes one notification per member of the group, in the database it is handed", async () => {
    await announceLeadAssignment(db, {
      leadId: "l1",
      name: "Mario Rossi",
      before: null,
      after: { ownerId: null, groupId: "g1" },
      actorId: "bruno",
    });
    expect(await bell()).toEqual([
      { user_id: "anna", type: "lead_assigned", title_key: "leadAssignedToGroup", link: "/dashboard/leads/l1" },
      { user_id: "carla", type: "lead_assigned", title_key: "leadAssignedToGroup", link: "/dashboard/leads/l1" },
    ]);
  });

  it("a reassignment in bulk is one notification, with how many", async () => {
    await announceLeadsAssigned(db, { ownerId: "anna", count: 12, actorId: "bruno" });
    await announceLeadsAssigned(db, { ownerId: "bruno", count: 3, actorId: "bruno" });
    expect(await bell()).toEqual([
      { user_id: "anna", type: "lead_assigned", title_key: "leadsAssigned", link: "/dashboard/leads" },
    ]);
  });
});

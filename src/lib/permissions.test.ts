/**
 * The capability model.
 *
 * This belongs on the tested boundary for the same reason the import API does:
 * when it is wrong it does not look like a failure. Before this model existed,
 * pages read the platform staff field and actions read the workspace membership,
 * with the result that a workspace owner could not open their own Settings while
 * a workspace admin could reach the panel that governs every other customer
 * (audit rilievi P-01, P-02).
 */
import { describe, expect, it } from "vitest";

import {
  assignableRoles,
  CAPABILITIES,
  can,
  canWrite,
  isPlatformStaffRole,
  normalizeTenantRole,
  outranks,
  TENANT_ROLES,
} from "./permissions";

const viewer = { userId: "u1", tenantRole: "viewer" as const, isPlatformStaff: false };
const editor = { userId: "u2", tenantRole: "editor" as const, isPlatformStaff: false };
const admin = { userId: "u3", tenantRole: "admin" as const, isPlatformStaff: false };
const owner = { userId: "u4", tenantRole: "owner" as const, isPlatformStaff: false };
const staff = { userId: "u5", tenantRole: "viewer" as const, isPlatformStaff: true };

describe("normalizeTenantRole", () => {
  it("fails closed on anything it does not recognise", () => {
    // A value left over from an old migration, or a hand-edited row, must not
    // open the product up.
    for (const raw of ["superuser", "", "ADMIN", "root", null, undefined]) {
      expect(normalizeTenantRole(raw as string)).toBe("viewer");
    }
  });

  it("maps the legacy 'user' value to editor", () => {
    // The UI wrote "user" where the translations and the model both said
    // "editor"; downgrading those rows to read-only would lock out real teams.
    expect(normalizeTenantRole("user")).toBe("editor");
  });

  it("passes through every real role", () => {
    for (const role of TENANT_ROLES) expect(normalizeTenantRole(role)).toBe(role);
  });
});

describe("can", () => {
  it("keeps the viewer read-only", () => {
    expect(can(viewer, "record:read")).toBe(true);
    expect(can(viewer, "record:write")).toBe(false);
    expect(can(viewer, "ticket:write")).toBe(false);
    expect(can(viewer, "quote:write")).toBe(false);
    expect(canWrite(viewer)).toBe(false);
  });

  it("lets an editor work but not configure", () => {
    expect(can(editor, "record:write")).toBe(true);
    expect(can(editor, "ticket:write")).toBe(true);
    expect(can(editor, "settings:manage")).toBe(false);
    expect(can(editor, "user:manage")).toBe(false);
    expect(can(editor, "webhook:manage")).toBe(false);
  });

  it("gives an admin configuration but not the subscription", () => {
    expect(can(admin, "settings:manage")).toBe(true);
    expect(can(admin, "user:manage")).toBe(true);
    expect(can(admin, "sla:manage")).toBe(true);
    expect(can(admin, "billing:manage")).toBe(false);
  });

  it("gives the owner everything", () => {
    for (const capability of Object.keys(CAPABILITIES) as (keyof typeof CAPABILITIES)[]) {
      expect(can(owner, capability)).toBe(true);
    }
  });

  it("accepts a bare role string, so the UI asks the same question as the server", () => {
    expect(can("viewer", "record:write")).toBe(false);
    expect(can("editor", "record:write")).toBe(true);
    expect(can("user", "record:write")).toBe(true); // legacy alias
    expect(can(null, "record:read")).toBe(false);
  });

  it("treats platform staff as an owner for data access", () => {
    expect(can(staff, "settings:manage")).toBe(true);
    expect(can(staff, "billing:manage")).toBe(true);
  });

  it("puts reading a report at the same level as reading the rows behind it", () => {
    // Every report action required admin, so a sales manager could not open a
    // report saved for them (audit rilievo U-10).
    expect(can(viewer, "report:read")).toBe(true);
    expect(can(viewer, "report:manage")).toBe(false);
    expect(can(admin, "report:manage")).toBe(true);
  });
});

describe("isPlatformStaffRole", () => {
  it("recognises only the two staff values", () => {
    expect(isPlatformStaffRole("admin")).toBe(true);
    expect(isPlatformStaffRole("owner")).toBe(true);
    expect(isPlatformStaffRole("user")).toBe(false);
    expect(isPlatformStaffRole("editor")).toBe(false);
    expect(isPlatformStaffRole("viewer")).toBe(false);
    expect(isPlatformStaffRole(null)).toBe(false);
  });
});

describe("assignableRoles", () => {
  it("stops anyone handing out a role above their own", () => {
    expect(assignableRoles(admin)).toEqual(["viewer", "editor", "admin"]);
    expect(assignableRoles(editor)).toEqual(["viewer", "editor"]);
    expect(assignableRoles(viewer)).toEqual(["viewer"]);
  });

  it("lets an owner grant ownership", () => {
    expect(assignableRoles(owner)).toEqual(["viewer", "editor", "admin", "owner"]);
  });
});

describe("outranks", () => {
  it("is strict, so equals cannot act on equals", () => {
    expect(outranks("owner", "admin")).toBe(true);
    expect(outranks("admin", "admin")).toBe(false);
    expect(outranks("admin", "owner")).toBe(false);
    expect(outranks("editor", "viewer")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import {
  availableDashboards,
  type DashboardAccess,
  defaultDashboard,
  parseHomeDashboard,
  resolveHomeDashboard,
} from "./home-dashboards";

const editor: DashboardAccess = {
  readsReports: true,
  managesSettings: false,
  managesEveryRecord: false,
  hasSales: true,
  hasSupport: true,
};
const admin: DashboardAccess = { ...editor, managesSettings: true, managesEveryRecord: true };

describe("which dashboards a person can open", () => {
  it("⚠️ keeps the money dashboard for administrators of a plan that has sales", () => {
    expect(availableDashboards(editor)).not.toContain("admin");
    expect(availableDashboards(admin)).toContain("admin");
    expect(availableDashboards({ ...admin, hasSales: false })).not.toContain("admin");
  });

  it("offers the desk only with support, and the team only to readers of reports", () => {
    expect(availableDashboards({ ...editor, hasSupport: false })).not.toContain("support");
    expect(availableDashboards({ ...editor, readsReports: false })).not.toContain("salesManager");
  });

  it("always offers one's own work and the business", () => {
    const none: DashboardAccess = {
      readsReports: false,
      managesSettings: false,
      managesEveryRecord: false,
      hasSales: false,
      hasSupport: false,
    };
    expect(availableDashboards(none)).toEqual(["sales", "direction"]);
  });
});

describe("which one opens", () => {
  it("is the address, then the saved choice, then the role", () => {
    expect(resolveHomeDashboard({ fromUrl: "support", saved: "direction" }, editor)).toBe("support");
    expect(resolveHomeDashboard({ saved: "salesManager" }, editor)).toBe("salesManager");
    expect(resolveHomeDashboard({}, editor)).toBe("sales");
    expect(resolveHomeDashboard({}, admin)).toBe("direction");
  });

  it("⚠️ falls through a dashboard the person can no longer open", () => {
    expect(resolveHomeDashboard({ fromUrl: "admin" }, editor)).toBe("sales");
    expect(resolveHomeDashboard({ saved: "admin", fromUrl: "nonsense" }, editor)).toBe("sales");
  });

  it("still understands the old view names in a link", () => {
    expect(parseHomeDashboard("me")).toBe("sales");
    expect(parseHomeDashboard("company")).toBe("direction");
    expect(parseHomeDashboard("team")).toBe("direction");
    expect(parseHomeDashboard(["support"])).toBe("support");
    expect(defaultDashboard(admin)).toBe("direction");
  });
});

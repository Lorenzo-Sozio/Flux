/**
 * The optional parts of the product a workspace can switch off.
 *
 * ⚠️ Why they are optional at all: a salesperson's menu carried project-management tools —
 * a Gantt chart with dependencies, a workload matrix — and an internal chat, beside the six
 * screens they actually use. They are not wrong, they are somebody else's job, and every
 * one of them is something to step over. The chat also polls the server every thirty seconds
 * from every open tab, which keeps a serverless database awake (CLAUDE.md).
 *
 *  - `projects` — the Gantt chart and the workload view.
 *  - `chat` — the internal chat: its page and the widget on every page.
 */
export const WORKSPACE_FEATURES = ["projects", "chat"] as const;
export type WorkspaceFeature = (typeof WORKSPACE_FEATURES)[number];
export type WorkspaceFeatures = Record<WorkspaceFeature, boolean>;

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
 *  - `ai` — the AI copilot (Fase 5). ⚠️ This switch only takes away: the copilot also needs the
 *    `ai` module in the workspace's plan and a provider configured on the deployment
 *    (src/lib/ai/access.ts). On by default, because the plan is what grants it.
 */
export const WORKSPACE_FEATURES = ["projects", "chat", "ai"] as const;
export type WorkspaceFeature = (typeof WORKSPACE_FEATURES)[number];
export type WorkspaceFeatures = Record<WorkspaceFeature, boolean>;

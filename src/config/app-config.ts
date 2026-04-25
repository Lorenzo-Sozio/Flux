import packageJson from "../../package.json";

const currentYear = new Date().getFullYear();

export const TASK_FEATURES = {
  subtasks: true,
  raci: true,
  timeTracking: true,
  dependencies: true,
  gantt: true,
  workload: true,
  autoScheduling: true,
} as const;

export const APP_CONFIG = {
  name: "Flux CRM",
  version: packageJson.version,
  copyright: `© ${currentYear}, Flux CRM.`,
  meta: {
    title: "Flux CRM - Modern CRM Platform",
    description:
      "Flux CRM is a modern, full-featured CRM platform built with Next.js, Tailwind CSS, and shadcn/ui. Manage leads, contacts, companies, deals, and more.",
  },
};

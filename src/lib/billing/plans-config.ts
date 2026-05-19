/**
 * Canonical plan definitions.
 * These are the seed values inserted via seedDefaultPlans() in admin-billing.ts.
 * Stripe IDs are null until an admin maps them in the admin panel.
 */

export type PlanLimits = {
  maxUsers: number | null; // null = unlimited
  apiCallsPerMonth: number | null;
  storageGb: number;
  automationRunsPerMonth: number | null;
  maxRecords: number | null;
  maxWorkspaces: number;
  maxIntegrations: number | null;
};

export type PlanModule = "crm" | "sales" | "marketing" | "support" | "automation" | "reporting" | "helpdesk";

export type SupportTier = "community" | "email" | "priority" | "dedicated";

export type SubscriptionStatus = "free" | "trialing" | "active" | "past_due" | "canceled" | "suspended";

export type AddonType = "extra_users" | "helpdesk" | "advanced_reporting" | "white_label" | "sandbox";

export type BillingCycle = "monthly" | "annual";

export interface PlanConfig {
  name: string;
  displayName: string;
  description: string;
  pricePerUserMonthly: number; // cents
  pricePerUserAnnual: number; // cents/month billed annually
  annualDiscountPercent: number;
  includedUsers: number;
  maxUsers: number | null;
  minUsers: number;
  extraUserPriceMonthly: number;
  extraUserPriceAnnual: number;
  trialDays: number;
  limits: PlanLimits;
  enabledModules: PlanModule[];
  supportTier: SupportTier;
  hasWhiteLabel: boolean;
  hasSandbox: boolean;
  isPublic: boolean;
  sortOrder: number;
}

export const PLAN_CONFIGS: Record<string, PlanConfig> = {
  free: {
    name: "free",
    displayName: "Free",
    description: "Get started — no credit card required.",
    pricePerUserMonthly: 0,
    pricePerUserAnnual: 0,
    annualDiscountPercent: 0,
    includedUsers: 1,
    maxUsers: 1,
    minUsers: 1,
    extraUserPriceMonthly: 0,
    extraUserPriceAnnual: 0,
    trialDays: 0,
    limits: {
      maxUsers: 1,
      apiCallsPerMonth: 1_000,
      storageGb: 1,
      automationRunsPerMonth: 10,
      maxRecords: 500,
      maxWorkspaces: 1,
      maxIntegrations: 1,
    },
    enabledModules: ["crm"],
    supportTier: "community",
    hasWhiteLabel: false,
    hasSandbox: false,
    isPublic: true,
    sortOrder: 0,
  },

  basic: {
    name: "basic",
    displayName: "Basic",
    description: "For small teams ready to grow.",
    pricePerUserMonthly: 1500, // €15/user/month
    pricePerUserAnnual: 1200, // €12/user/month billed annually
    annualDiscountPercent: 20,
    includedUsers: 3,
    maxUsers: 10,
    minUsers: 1,
    extraUserPriceMonthly: 1500,
    extraUserPriceAnnual: 1200,
    trialDays: 14,
    limits: {
      maxUsers: 10,
      apiCallsPerMonth: 10_000,
      storageGb: 10,
      automationRunsPerMonth: 100,
      maxRecords: 5_000,
      maxWorkspaces: 1,
      maxIntegrations: 3,
    },
    enabledModules: ["crm", "sales", "support"],
    supportTier: "email",
    hasWhiteLabel: false,
    hasSandbox: false,
    isPublic: true,
    sortOrder: 1,
  },

  professional: {
    name: "professional",
    displayName: "Professional",
    description: "Full CRM suite for growing businesses.",
    pricePerUserMonthly: 2500, // €25/user/month
    pricePerUserAnnual: 2000, // €20/user/month billed annually
    annualDiscountPercent: 20,
    includedUsers: 5,
    maxUsers: 50,
    minUsers: 1,
    extraUserPriceMonthly: 2000,
    extraUserPriceAnnual: 1600,
    trialDays: 14,
    limits: {
      maxUsers: 50,
      apiCallsPerMonth: 50_000,
      storageGb: 50,
      automationRunsPerMonth: 1_000,
      maxRecords: 50_000,
      maxWorkspaces: 3,
      maxIntegrations: 10,
    },
    enabledModules: ["crm", "sales", "marketing", "support", "automation", "reporting"],
    supportTier: "priority",
    hasWhiteLabel: false,
    hasSandbox: true,
    isPublic: true,
    sortOrder: 2,
  },

  enterprise: {
    name: "enterprise",
    displayName: "Enterprise",
    description: "Unlimited scale, white-label, and dedicated support.",
    pricePerUserMonthly: 5000, // €50/user/month
    pricePerUserAnnual: 4000, // €40/user/month billed annually
    annualDiscountPercent: 20,
    includedUsers: 10,
    maxUsers: null,
    minUsers: 10,
    extraUserPriceMonthly: 4000,
    extraUserPriceAnnual: 3200,
    trialDays: 30,
    limits: {
      maxUsers: null,
      apiCallsPerMonth: null,
      storageGb: 500,
      automationRunsPerMonth: null,
      maxRecords: null,
      maxWorkspaces: 10,
      maxIntegrations: null,
    },
    enabledModules: ["crm", "sales", "marketing", "support", "automation", "reporting", "helpdesk"],
    supportTier: "dedicated",
    hasWhiteLabel: true,
    hasSandbox: true,
    isPublic: true,
    sortOrder: 3,
  },
};

/** Add-on definitions (per-unit monthly prices in cents). */
export const ADDON_CONFIGS: Record<
  AddonType,
  { displayName: string; description: string; priceMonthly: number; priceAnnual: number }
> = {
  extra_users: {
    displayName: "Extra Users",
    description: "Additional user seats beyond your plan's included quota.",
    priceMonthly: 1500,
    priceAnnual: 1200,
  },
  helpdesk: {
    displayName: "Helpdesk Module",
    description: "Advanced ticket management, SLA automation, and chat.",
    priceMonthly: 2000,
    priceAnnual: 1600,
  },
  advanced_reporting: {
    displayName: "Advanced Reporting",
    description: "Custom report builder, scheduled exports, and BI exports.",
    priceMonthly: 1500,
    priceAnnual: 1200,
  },
  white_label: {
    displayName: "White Label",
    description: "Custom domain, brand colors, and hidden Flux branding.",
    priceMonthly: 5000,
    priceAnnual: 4000,
  },
  sandbox: {
    displayName: "Sandbox Environment",
    description: "Isolated test environment mirroring your production tenant.",
    priceMonthly: 2500,
    priceAnnual: 2000,
  },
};

/** Returns the alert thresholds used for usage monitoring. */
export const USAGE_ALERT_THRESHOLDS = [80, 90, 100] as const;

/** Days of non-payment before automatic downgrade to Free. */
export const GRACE_PERIOD_DAYS = 7;

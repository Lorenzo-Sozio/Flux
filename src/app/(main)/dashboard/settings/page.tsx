import Link from "next/link";

import {
  BellRing,
  Building2,
  ChevronRight,
  CreditCard,
  FileInput,
  GitMerge,
  KeyRound,
  ListTree,
  Mail,
  MapPin,
  MessageSquareQuote,
  Receipt,
  Settings2,
  Timer,
  ToggleRight,
  Webhook,
} from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getEntitlements } from "@/lib/billing/licensing";
import type { PlanModule } from "@/lib/billing/plans-config";
import { requirePageCapability } from "@/lib/page-guard";
import { type Capability, can } from "@/lib/permissions";
import { getCurrentTenantId } from "@/lib/tenant-context";

export default async function SettingsPage() {
  // ⚠️ Everybody, with each card behind its own capability: the index used to be for
  // administrators only, so an editor reached their notification settings from the bell
  // and nowhere else.
  const actor = await requirePageCapability("record:read", "/dashboard/settings");
  // Cards for a module the plan does not include are left out, as in the menu.
  const tenantId = await getCurrentTenantId();
  const modules = tenantId ? (await getEntitlements(tenantId).catch(() => null))?.enabledModules : undefined;
  const inPlan = (module?: PlanModule) => !module || !modules || modules.includes(module);

  const t = await getTranslations("settings");
  const tMacros = await getTranslations("support.macros");

  // Pipeline stages and macros used to live only at their URL: absent from the
  // sidebar AND from this index, so configuring the pipeline — the first thing
  // anyone does when adopting a CRM — meant typing the path by hand.
  const cards: {
    href: string;
    icon: typeof CreditCard;
    title: string;
    description: string;
    need: Capability;
    module?: PlanModule;
  }[] = [
    {
      // The workspace's clock, what a new quote starts with, the logo on its documents.
      href: "/dashboard/settings/general",
      icon: Building2,
      title: t("generalPage.title"),
      description: t("generalPage.subtitle"),
      need: "settings:manage",
    },
    {
      // Personal, not administrative: gated on the capability every role has, so
      // a viewer can still decide what reaches their own phone.
      href: "/dashboard/settings/notifications",
      icon: BellRing,
      title: t("notifications.title"),
      description: t("notifications.description"),
      need: "record:read",
    },
    {
      href: "/dashboard/settings/billing",
      icon: CreditCard,
      title: t("billing.title"),
      description: t("billing.description"),
      need: "billing:read",
    },
    {
      // Which optional parts the workspace uses: project planning, internal chat.
      href: "/dashboard/settings/features",
      icon: ToggleRight,
      title: t("features.title"),
      description: t("features.description"),
      need: "settings:manage",
    },
    {
      href: "/dashboard/settings/pipeline",
      icon: GitMerge,
      title: t("pipeline.title"),
      description: t("pipeline.description"),
      need: "pipeline:manage",
    },
    {
      href: "/dashboard/settings/territories",
      icon: MapPin,
      title: t("territories.title"),
      description: t("territories.description"),
      need: "territory:manage",
      module: "sales",
    },
    {
      href: "/dashboard/settings/invoicing",
      icon: Receipt,
      title: t("invoicing.title"),
      description: t("invoicing.description"),
      need: "invoicing:manage",
      module: "sales",
    },
    {
      // The public forms a website can send leads and support requests through.
      href: "/dashboard/settings/forms",
      icon: FileInput,
      title: t("forms.title"),
      description: t("forms.description"),
      need: "settings:manage",
    },
    {
      // Company categories and types: renamed, merged, removed.
      href: "/dashboard/settings/lists",
      icon: ListTree,
      title: t("lists.title"),
      description: t("lists.subtitle"),
      need: "settings:manage",
    },
    {
      href: "/dashboard/settings/custom-fields",
      icon: Settings2,
      title: t("customFields.title"),
      description: t("customFields.description"),
      need: "customField:manage",
    },
    {
      href: "/dashboard/settings/email",
      icon: Mail,
      title: t("email.title"),
      description: t("email.description"),
      need: "emailSettings:manage",
    },
    {
      href: "/dashboard/settings/macros",
      icon: MessageSquareQuote,
      title: tMacros("title"),
      description: tMacros("subtitle"),
      need: "macro:manage",
      module: "support",
    },
    {
      // Configured under Support, and absent from this index until now.
      href: "/dashboard/support/sla",
      icon: Timer,
      title: t("sla.title"),
      description: t("sla.description"),
      need: "sla:manage",
      module: "support",
    },
    {
      href: "/dashboard/settings/webhooks",
      icon: Webhook,
      title: t("webhooks.title"),
      description: t("webhooks.description"),
      need: "webhook:manage",
    },
    // ⚠️ Next to the webhooks and nowhere else: somebody connecting an external system
    // needs both at the same moment — the key to call with, the webhook secret to verify
    // what arrives — and finding them in two different places is where a configuration
    // stalls.
    {
      href: "/dashboard/settings/api",
      icon: KeyRound,
      title: "API",
      description: t("apiKey.cardDescription"),
      need: "settings:manage",
    },
  ];

  const visible = cards.filter((c) => can(actor, c.need) && inPlan(c.module));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("indexSubtitle")}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map(({ href, icon: Icon, title, description }) => (
          <Link key={href} href={href}>
            {/* ⚠️ Below sm a row, not a tile. Ten tiles of a 32px icon over a
                title over a sentence were a thousand pixels of scrolling to find
                the one setting somebody came for; icon beside text reads as the
                list it is, and the chevron says each row goes somewhere. */}
            <Card className="h-full cursor-pointer py-4 transition-shadow hover:shadow-md sm:py-6">
              <CardHeader className="flex items-start gap-3 px-4 sm:grid sm:gap-1 sm:px-6">
                <Icon className="mt-0.5 size-5 shrink-0 text-primary sm:mt-0 sm:mb-2 sm:size-8" />
                <div className="grid min-w-0 flex-1 gap-1">
                  <CardTitle>{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </div>
                <ChevronRight className="size-4 shrink-0 self-center text-muted-foreground sm:hidden" />
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

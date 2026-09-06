import Link from "next/link";

import { CreditCard, GitMerge, KeyRound, Mail, MessageSquareQuote, Settings2, Webhook } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePageCapability } from "@/lib/page-guard";
import { type Capability, can } from "@/lib/permissions";

export default async function SettingsPage() {
  const actor = await requirePageCapability("settings:read", "/dashboard/settings");

  const t = await getTranslations("settings");
  const tMacros = await getTranslations("support.macros");

  // Pipeline stages and macros used to live only at their URL: absent from the
  // sidebar AND from this index, so configuring the pipeline — the first thing
  // anyone does when adopting a CRM — meant typing the path by hand.
  const cards: { href: string; icon: typeof CreditCard; title: string; description: string; need: Capability }[] = [
    {
      href: "/dashboard/settings/billing",
      icon: CreditCard,
      title: t("billing.title"),
      description: t("billing.description"),
      need: "billing:read",
    },
    {
      href: "/dashboard/settings/pipeline",
      icon: GitMerge,
      title: t("pipeline.title"),
      description: t("pipeline.description"),
      need: "pipeline:manage",
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
      description: "La chiave con cui un sistema esterno scrive qui dentro, e l'identificativo di questa attività.",
      need: "settings:manage",
    },
  ];

  const visible = cards.filter((c) => can(actor, c.need));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("general.title")}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map(({ href, icon: Icon, title, description }) => (
          <Link key={href} href={href}>
            <Card className="h-full cursor-pointer transition-shadow hover:shadow-md">
              <CardHeader>
                <Icon className="mb-2 h-8 w-8 text-primary" />
                <CardTitle>{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

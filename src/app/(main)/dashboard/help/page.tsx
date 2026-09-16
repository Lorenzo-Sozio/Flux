"use client";

import { useRef, useState } from "react";

import Link from "next/link";

import {
  ArrowRight,
  Banknote,
  BarChart3,
  Bell,
  BookOpen,
  Building2,
  Calendar,
  CheckSquare,
  ChevronRight,
  Clock,
  Contact,
  FileText,
  GanttChartSquare,
  GitMerge,
  HelpCircle,
  Info,
  Kanban,
  Mail,
  MessageCircle,
  MessageSquare,
  Package,
  Search,
  Settings,
  Shield,
  ShoppingCart,
  Star,
  Target,
  TrendingUp,
  UserCheck,
  Users,
  Webhook,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Data ─────────────────────────────────────────────────────────────────────

/**
 * The text of every section — title, subtitle, description and the FAQ — lives in
 * the message files under `helpCenter.sections.<key>`, in both languages. This
 * list holds only what is not language: anchor, icon, colours and destination.
 */
const sections = [
  {
    id: "primi-passi",
    key: "gettingStarted",
    icon: Star,
    color: "text-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-800",
    href: null,
  },
  {
    id: "leads",
    key: "leads",
    icon: Users,
    color: "text-green-500",
    bg: "bg-green-50 dark:bg-green-950/30",
    border: "border-green-200 dark:border-green-800",
    href: "/dashboard/leads",
  },
  {
    id: "contatti",
    key: "contacts",
    icon: Contact,
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200 dark:border-blue-800",
    href: "/dashboard/contacts",
  },
  {
    id: "aziende",
    key: "companies",
    icon: Building2,
    color: "text-indigo-500",
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    border: "border-indigo-200 dark:border-indigo-800",
    href: "/dashboard/companies",
  },
  {
    id: "pipeline",
    key: "pipeline",
    icon: Kanban,
    color: "text-violet-500",
    bg: "bg-violet-50 dark:bg-violet-950/30",
    border: "border-violet-200 dark:border-violet-800",
    href: "/dashboard/pipeline",
  },
  {
    id: "finance",
    key: "finance",
    icon: Banknote,
    color: "text-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    border: "border-emerald-200 dark:border-emerald-800",
    href: "/dashboard/sales/finance",
  },
  {
    id: "prodotti",
    key: "products",
    icon: Package,
    color: "text-orange-500",
    bg: "bg-orange-50 dark:bg-orange-950/30",
    border: "border-orange-200 dark:border-orange-800",
    href: "/dashboard/sales/products",
  },
  {
    id: "preventivi",
    key: "quotes",
    icon: FileText,
    color: "text-violet-500",
    bg: "bg-violet-50 dark:bg-violet-950/30",
    border: "border-violet-200 dark:border-violet-800",
    href: "/dashboard/sales/quotes",
  },
  {
    id: "ordini",
    key: "orders",
    icon: ShoppingCart,
    color: "text-pink-500",
    bg: "bg-pink-50 dark:bg-pink-950/30",
    border: "border-pink-200 dark:border-pink-800",
    href: "/dashboard/sales/orders",
  },
  {
    id: "targets-funnel",
    key: "targetsFunnel",
    icon: TrendingUp,
    color: "text-cyan-500",
    bg: "bg-cyan-50 dark:bg-cyan-950/30",
    border: "border-cyan-200 dark:border-cyan-800",
    href: "/dashboard/pipeline/targets",
  },
  {
    id: "marketing",
    key: "marketing",
    icon: Mail,
    color: "text-rose-500",
    bg: "bg-rose-50 dark:bg-rose-950/30",
    border: "border-rose-200 dark:border-rose-800",
    href: "/dashboard/marketing/campaigns",
  },
  {
    id: "task",
    key: "tasks",
    icon: CheckSquare,
    color: "text-teal-500",
    bg: "bg-teal-50 dark:bg-teal-950/30",
    border: "border-teal-200 dark:border-teal-800",
    href: "/dashboard/tasks",
  },
  {
    id: "calendario",
    key: "calendar",
    icon: Calendar,
    color: "text-sky-500",
    bg: "bg-sky-50 dark:bg-sky-950/30",
    border: "border-sky-200 dark:border-sky-800",
    href: "/dashboard/calendar",
  },
  {
    id: "chat",
    key: "chat",
    icon: MessageCircle,
    color: "text-purple-500",
    bg: "bg-purple-50 dark:bg-purple-950/30",
    border: "border-purple-200 dark:border-purple-800",
    href: "/dashboard/chat",
  },
  {
    id: "ticket",
    key: "tickets",
    icon: MessageSquare,
    color: "text-amber-500",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200 dark:border-amber-800",
    href: "/dashboard/support/tickets",
  },
  {
    id: "automazione",
    key: "automation",
    icon: Zap,
    color: "text-yellow-500",
    bg: "bg-yellow-50 dark:bg-yellow-950/30",
    border: "border-yellow-200 dark:border-yellow-800",
    href: "/dashboard/automation",
  },
  {
    id: "report",
    key: "reports",
    icon: BarChart3,
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200 dark:border-blue-800",
    href: "/dashboard/reports",
  },
  {
    id: "impostazioni",
    key: "settings",
    icon: Settings,
    color: "text-gray-500",
    bg: "bg-gray-50 dark:bg-gray-950/30",
    border: "border-gray-200 dark:border-gray-700",
    href: "/dashboard/settings",
  },
  {
    id: "notifiche",
    key: "notifications",
    icon: Bell,
    color: "text-orange-500",
    bg: "bg-orange-50 dark:bg-orange-950/30",
    border: "border-orange-200 dark:border-orange-800",
    href: null,
  },
  {
    id: "utenti-ruoli",
    key: "usersRoles",
    icon: Shield,
    color: "text-red-500",
    bg: "bg-red-50 dark:bg-red-950/30",
    border: "border-red-200 dark:border-red-800",
    href: "/dashboard/users",
  },
];

// ─── Component ─────────────────────────────────────────────────────────────────

type HelpTopic = { q: string; a: string };

export default function HelpPage() {
  const t = useTranslations("helpCenter");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  // `t.raw`, not `t`: the answers are prose that quotes headers such as
  // `Authorization: Bearer <key>`, which ICU would read as a markup tag.
  const localized = sections.map((s) => ({
    ...s,
    title: t.raw(`sections.${s.key}.title`) as string,
    subtitle: t.raw(`sections.${s.key}.subtitle`) as string,
    description: t.raw(`sections.${s.key}.description`) as string,
    topics: Object.values((t.raw(`sections.${s.key}.topics`) ?? {}) as Record<string, HelpTopic>),
  }));

  const filtered = localized.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.subtitle.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.topics.some((t) => t.q.toLowerCase().includes(q) || t.a.toLowerCase().includes(q))
    );
  });

  function scrollTo(id: string) {
    const el = sectionRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveId(id);
    }
  }

  return (
    <div className="flex min-h-full gap-6">
      {/* ── TOC Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="hidden w-64 shrink-0 xl:block">
        <div className="sticky top-4 space-y-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>
          {/* Nav */}
          <nav className="space-y-0.5">
            {localized.map((s) => {
              const Icon = s.icon;
              const isVisible = filtered.some((f) => f.id === s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => scrollTo(s.id)}
                  disabled={!isVisible}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors",
                    activeId === s.id
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    !isVisible && "opacity-30 pointer-events-none",
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5 shrink-0", s.color)} />
                  {s.title}
                </button>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────────────── */}
      <div className="min-w-0 flex-1 space-y-6 pb-16">
        {/* Header */}
        <div className="flex items-start gap-4 rounded-xl border bg-gradient-to-br from-primary/5 to-primary/0 p-6">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
            <HelpCircle className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
            <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>

        {/* Mobile search */}
        <div className="relative xl:hidden">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Quick links */}
        {!search && (
          <div>
            <p className="mb-3 font-medium text-sm text-muted-foreground uppercase tracking-wide">
              {t("mainSections")}
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {localized.slice(0, 8).map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => scrollTo(s.id)}
                    className={cn(
                      "group flex items-center gap-2.5 rounded-lg border p-3 text-left transition-all hover:shadow-sm",
                      s.bg,
                      s.border,
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", s.color)} />
                    <span className="truncate font-medium text-sm">{s.title}</span>
                    <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Sections */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <Search className="mb-4 h-10 w-10 text-muted-foreground/30" />
            <p className="font-medium text-muted-foreground">{t("noResults", { search })}</p>
            <p className="mt-1 text-muted-foreground text-sm">{t("tryDifferent")}</p>
          </div>
        ) : (
          filtered.map((section) => {
            const Icon = section.icon;
            return (
              <section
                key={section.id}
                id={section.id}
                ref={(el) => {
                  sectionRefs.current[section.id] = el;
                }}
                className="scroll-mt-6"
              >
                <Card className={cn("overflow-hidden border", section.border)}>
                  {/* Section header */}
                  <CardHeader className={cn("flex flex-row items-center gap-4 border-b pb-4", section.bg)}>
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
                        section.bg,
                        "border",
                        section.border,
                      )}
                    >
                      <Icon className={cn("h-5 w-5", section.color)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-lg">{section.title}</CardTitle>
                        <Badge variant="secondary" className="font-normal text-xs">
                          {section.subtitle}
                        </Badge>
                      </div>
                    </div>
                    {section.href && (
                      <Link
                        href={section.href}
                        className={cn(
                          "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                          "border",
                          section.border,
                          "hover:bg-background/60",
                          section.color,
                        )}
                      >
                        {t("goToSection")}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </CardHeader>

                  <CardContent className="p-0">
                    {/* Description */}
                    <div className="flex items-start gap-3 border-b bg-muted/20 px-6 py-4">
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <p className="text-muted-foreground text-sm leading-relaxed">{section.description}</p>
                    </div>

                    {/* FAQ */}
                    <Accordion type="multiple" className="divide-y">
                      {section.topics.map((topic, i) => (
                        <AccordionItem key={i} value={`${section.id}-${i}`} className="border-0 px-6">
                          <AccordionTrigger className="py-4 text-left text-sm font-medium hover:no-underline">
                            {topic.q}
                          </AccordionTrigger>
                          {/*
                            `whitespace-pre-line` so an answer that needs two
                            paragraphs can have them. Answers written as one block
                            are unaffected: they contain no newlines to honour.
                          */}
                          <AccordionContent className="whitespace-pre-line pb-4 text-muted-foreground text-sm leading-relaxed">
                            {topic.a}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </CardContent>
                </Card>
              </section>
            );
          })
        )}

        {/* Footer */}
        <div className="rounded-xl border bg-muted/30 p-6 text-center">
          <p className="font-medium text-sm">{t("notFoundTitle")}</p>
          <p className="mt-1 text-muted-foreground text-sm">{t("notFoundHint")}</p>
        </div>
      </div>
    </div>
  );
}

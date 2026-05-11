"use client";

import { useState, useTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { createPlan, updatePlan } from "@/actions/admin-billing";
import type { UpsertPlanInput } from "@/actions/admin-billing";
import type { PlanModule, PlanLimits } from "@/lib/billing/plans-config";
import {
  Tag,
  CreditCard,
  Layers,
  BarChart2,
  Star,
  Zap,
  Infinity,
  Loader2,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_MODULES: { id: PlanModule; label: string; description: string }[] = [
  { id: "crm",        label: "CRM",        description: "Contacts & companies" },
  { id: "sales",      label: "Sales",      description: "Pipeline & deals" },
  { id: "marketing",  label: "Marketing",  description: "Campaigns & lists" },
  { id: "support",    label: "Support",    description: "Tickets & SLA" },
  { id: "automation", label: "Automation", description: "Rules & workflows" },
  { id: "reporting",  label: "Reporting",  description: "Analytics & dashboards" },
  { id: "helpdesk",   label: "Helpdesk",   description: "Advanced ticket management" },
];

const SUPPORT_TIERS = [
  { value: "community", label: "Community",  description: "Forum & docs only" },
  { value: "email",     label: "Email",      description: "Business hours support" },
  { value: "priority",  label: "Priority",   description: "24-hour response SLA" },
  { value: "dedicated", label: "Dedicated",  description: "Named account manager" },
];

const DEFAULT_LIMITS: PlanLimits = {
  maxUsers: 5,
  apiCallsPerMonth: 10000,
  storageGb: 10,
  automationRunsPerMonth: 100,
  maxRecords: 5000,
  maxWorkspaces: 1,
  maxIntegrations: 3,
};

const DEFAULT_MODULES: PlanModule[] = ["crm", "sales", "support"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toCents = (v: string | number) => Math.round(Number(v) * 100);
const toEuros = (cents: number) => (cents / 100).toFixed(2);

function parseLimits(json: string): PlanLimits {
  try { return { ...DEFAULT_LIMITS, ...JSON.parse(json) }; }
  catch { return { ...DEFAULT_LIMITS }; }
}

function parseModules(json: string): PlanModule[] {
  try {
    const p = JSON.parse(json);
    return Array.isArray(p) ? p : DEFAULT_MODULES;
  } catch { return DEFAULT_MODULES; }
}

interface LimitState {
  maxUsers: string;              maxUsersUnlimited: boolean;
  apiCallsPerMonth: string;      apiCallsUnlimited: boolean;
  storageGb: string;
  automationRunsPerMonth: string; automationUnlimited: boolean;
  maxRecords: string;            maxRecordsUnlimited: boolean;
  maxWorkspaces: string;
  maxIntegrations: string;       maxIntegrationsUnlimited: boolean;
}

function toLimitState(l: PlanLimits): LimitState {
  return {
    maxUsers: l.maxUsers != null ? String(l.maxUsers) : "",
    maxUsersUnlimited: l.maxUsers === null,
    apiCallsPerMonth: l.apiCallsPerMonth != null ? String(l.apiCallsPerMonth) : "",
    apiCallsUnlimited: l.apiCallsPerMonth === null,
    storageGb: String(l.storageGb),
    automationRunsPerMonth: l.automationRunsPerMonth != null ? String(l.automationRunsPerMonth) : "",
    automationUnlimited: l.automationRunsPerMonth === null,
    maxRecords: l.maxRecords != null ? String(l.maxRecords) : "",
    maxRecordsUnlimited: l.maxRecords === null,
    maxWorkspaces: String(l.maxWorkspaces),
    maxIntegrations: l.maxIntegrations != null ? String(l.maxIntegrations) : "",
    maxIntegrationsUnlimited: l.maxIntegrations === null,
  };
}

function toLimitsJson(s: LimitState): string {
  return JSON.stringify({
    maxUsers:              s.maxUsersUnlimited    ? null : Number(s.maxUsers) || 0,
    apiCallsPerMonth:      s.apiCallsUnlimited    ? null : Number(s.apiCallsPerMonth) || 0,
    storageGb:             Number(s.storageGb) || 0,
    automationRunsPerMonth: s.automationUnlimited ? null : Number(s.automationRunsPerMonth) || 0,
    maxRecords:            s.maxRecordsUnlimited  ? null : Number(s.maxRecords) || 0,
    maxWorkspaces:         Number(s.maxWorkspaces) || 1,
    maxIntegrations:       s.maxIntegrationsUnlimited ? null : Number(s.maxIntegrations) || 0,
  } satisfies PlanLimits);
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface PlanFormProps {
  plan?: Partial<UpsertPlanInput & { id: string; description?: string | null }>;
  onCancel?: () => void;
  onSuccess?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PlanForm({ plan, onCancel, onSuccess }: PlanFormProps) {
  const isEdit = !!plan?.id;
  const [pending, startTransition] = useTransition();

  // — General —
  const [name,        setName]        = useState(plan?.name ?? "");
  const [displayName, setDisplayName] = useState(plan?.displayName ?? "");
  const [description, setDescription] = useState(plan?.description ?? "");
  const [sortOrder,   setSortOrder]   = useState(String(plan?.sortOrder ?? 0));
  const [isActive,    setIsActive]    = useState(plan?.isActive ?? true);
  const [isPublic,    setIsPublic]    = useState(plan?.isPublic ?? true);
  const [isCustom,    setIsCustom]    = useState(plan?.isCustom ?? false);

  // — Pricing —
  const [priceMonthly, setPriceMonthly] = useState(toEuros(plan?.pricePerUserMonthly ?? 0));
  const [priceAnnual,  setPriceAnnual]  = useState(toEuros(plan?.pricePerUserAnnual  ?? 0));
  const [discount,     setDiscount]     = useState(String(plan?.annualDiscountPercent ?? 20));
  const [autoCalc,     setAutoCalc]     = useState(false);
  const [trialDays,    setTrialDays]    = useState(String(plan?.trialDays ?? 0));
  const [includedUsers,setIncludedUsers]= useState(String(plan?.includedUsers ?? 1));
  const [minUsers,     setMinUsers]     = useState(String(plan?.minUsers ?? 1));
  const [maxUsersVal,  setMaxUsersVal]  = useState(plan?.maxUsers != null ? String(plan.maxUsers) : "");
  const [maxUnlimited, setMaxUnlimited] = useState(plan?.maxUsers === null);
  const [extraMonthly, setExtraMonthly] = useState(toEuros(plan?.extraUserPriceMonthly ?? 0));
  const [extraAnnual,  setExtraAnnual]  = useState(toEuros(plan?.extraUserPriceAnnual  ?? 0));

  // — Modules —
  const [modules, setModules] = useState<Set<PlanModule>>(
    () => new Set(parseModules(plan?.enabledModules ?? JSON.stringify(DEFAULT_MODULES))),
  );

  // — Limits —
  const [limits, setLimits] = useState<LimitState>(() =>
    toLimitState(parseLimits(plan?.limits ?? JSON.stringify(DEFAULT_LIMITS))),
  );

  // — Features —
  const [supportTier,   setSupportTier]   = useState(plan?.supportTier ?? "email");
  const [hasWhiteLabel, setHasWhiteLabel] = useState(plan?.hasWhiteLabel ?? false);
  const [hasSandbox,    setHasSandbox]    = useState(plan?.hasSandbox ?? false);

  // — Stripe —
  const [stripeProductId,             setStripeProductId]             = useState(plan?.stripeProductId ?? "");
  const [stripePriceMonthlyId,        setStripePriceMonthlyId]        = useState(plan?.stripePriceMonthlyId ?? "");
  const [stripePriceAnnualId,         setStripePriceAnnualId]         = useState(plan?.stripePriceAnnualId ?? "");
  const [stripeExtraUserMonthlyPriceId, setStripeExtraUserMonthlyPriceId] = useState(plan?.stripeExtraUserMonthlyPriceId ?? "");
  const [stripeExtraUserAnnualPriceId,  setStripeExtraUserAnnualPriceId]  = useState(plan?.stripeExtraUserAnnualPriceId ?? "");

  useEffect(() => {
    if (!autoCalc) return;
    const m = Number(priceMonthly), d = Number(discount);
    if (!isNaN(m) && !isNaN(d)) setPriceAnnual((m * (1 - d / 100)).toFixed(2));
  }, [priceMonthly, discount, autoCalc]);

  function patchLimit<K extends keyof LimitState>(k: K, v: LimitState[K]) {
    setLimits((p) => ({ ...p, [k]: v }));
  }

  function toggleModule(mod: PlanModule) {
    setModules((prev) => {
      const next = new Set(prev);
      next.has(mod) ? next.delete(mod) : next.add(mod);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input: UpsertPlanInput = {
      name,
      displayName,
      description: description || undefined,
      stripeProductId: stripeProductId || undefined,
      stripePriceMonthlyId: stripePriceMonthlyId || undefined,
      stripePriceAnnualId: stripePriceAnnualId || undefined,
      stripeExtraUserMonthlyPriceId: stripeExtraUserMonthlyPriceId || undefined,
      stripeExtraUserAnnualPriceId: stripeExtraUserAnnualPriceId || undefined,
      pricePerUserMonthly: toCents(priceMonthly),
      pricePerUserAnnual:  toCents(priceAnnual),
      annualDiscountPercent: Number(discount),
      includedUsers: Number(includedUsers),
      maxUsers: maxUnlimited ? null : (Number(maxUsersVal) || null),
      minUsers: Number(minUsers),
      extraUserPriceMonthly: toCents(extraMonthly),
      extraUserPriceAnnual:  toCents(extraAnnual),
      trialDays: Number(trialDays),
      limits: toLimitsJson(limits),
      enabledModules: JSON.stringify(Array.from(modules)),
      supportTier,
      hasWhiteLabel,
      hasSandbox,
      isActive,
      isPublic,
      sortOrder: Number(sortOrder),
      isCustom,
    };

    startTransition(async () => {
      try {
        if (isEdit) {
          await updatePlan(plan!.id!, input);
          toast.success("Plan updated.");
        } else {
          await createPlan(input);
          toast.success("Plan created.");
        }
        onSuccess?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to save plan");
      }
    });
  }

  const monthlyNum = Number(priceMonthly) || 0;
  const annualNum  = Number(priceAnnual)  || 0;
  const savings    = monthlyNum > 0 ? Math.round(((monthlyNum - annualNum) / monthlyNum) * 100) : 0;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <Tabs defaultValue="general">

          <TabsList className="w-full mb-5">
            <TabsTrigger value="general"  className="flex-1 gap-1.5"><Tag        className="h-3.5 w-3.5" />General</TabsTrigger>
            <TabsTrigger value="pricing"  className="flex-1 gap-1.5"><CreditCard className="h-3.5 w-3.5" />Pricing</TabsTrigger>
            <TabsTrigger value="modules"  className="flex-1 gap-1.5"><Layers     className="h-3.5 w-3.5" />Modules</TabsTrigger>
            <TabsTrigger value="limits"   className="flex-1 gap-1.5"><BarChart2  className="h-3.5 w-3.5" />Limits</TabsTrigger>
            <TabsTrigger value="features" className="flex-1 gap-1.5"><Star       className="h-3.5 w-3.5" />Features</TabsTrigger>
            <TabsTrigger value="stripe"   className="flex-1 gap-1.5"><Zap        className="h-3.5 w-3.5" />Stripe</TabsTrigger>
          </TabsList>

          {/* ─── General ─────────────────────────────────────────────────── */}
          <TabsContent value="general" className="grid grid-cols-2 gap-x-4 gap-y-4 mt-0">
            <F label="Internal name (slug)">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                placeholder="professional"
                required
                disabled={isEdit}
                className={isEdit ? "bg-muted text-muted-foreground" : ""}
              />
              {isEdit && <p className="text-xs text-muted-foreground mt-1">Slug cannot be changed after creation.</p>}
            </F>
            <F label="Display name">
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Professional"
                required
              />
            </F>
            <div className="col-span-2">
              <F label="Description">
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description shown to customers on the pricing page."
                  rows={2}
                  className="resize-none"
                />
              </F>
            </div>
            <F label="Sort order">
              <Input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                min={0}
              />
            </F>
            <div /> {/* spacer */}
            <div className="col-span-2 space-y-2">
              <ToggleRow
                label="Active"
                description="Tenants can subscribe to this plan."
                checked={isActive}
                onChange={setIsActive}
              />
              <ToggleRow
                label="Public"
                description="Shown on the public pricing page."
                checked={isPublic}
                onChange={setIsPublic}
              />
              <ToggleRow
                label="Custom / negotiated"
                description="Hidden from public pricing; assigned manually by admins."
                checked={isCustom}
                onChange={setIsCustom}
              />
            </div>
          </TabsContent>

          {/* ─── Pricing ─────────────────────────────────────────────────── */}
          <TabsContent value="pricing" className="grid grid-cols-2 gap-x-4 gap-y-4 mt-0">
            <F label="Monthly price / user">
              <EuroInput value={priceMonthly} onChange={setPriceMonthly} placeholder="25.00" />
            </F>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Annual price / user / mo
                </Label>
                <button
                  type="button"
                  onClick={() => setAutoCalc((v) => !v)}
                  className={`text-[11px] px-2 py-0.5 rounded border transition-colors ${
                    autoCalc
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  Auto-calc
                </button>
              </div>
              <EuroInput value={priceAnnual} onChange={setPriceAnnual} placeholder="20.00" disabled={autoCalc} />
            </div>
            <F label="Annual discount %">
              <SuffixInput value={discount} onChange={setDiscount} suffix="%" type="number" min={0} max={100} />
            </F>
            <F label="Trial period">
              <SuffixInput value={trialDays} onChange={setTrialDays} suffix="days" type="number" min={0} />
            </F>

            {monthlyNum > 0 && annualNum > 0 && (
              <div className="col-span-2 rounded-md bg-muted px-4 py-2.5 text-sm text-muted-foreground">
                Annual billing saves{" "}
                <span className="font-semibold text-foreground">{savings}%</span>
                {" "}— €{((monthlyNum - annualNum) * 12).toFixed(2)} per user per year.
              </div>
            )}

            <div className="col-span-2">
              <Separator className="my-1" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mt-3 mb-3">User seats</p>
            </div>

            <F label="Included users">
              <Input type="number" value={includedUsers} onChange={(e) => setIncludedUsers(e.target.value)} min={1} />
            </F>
            <F label="Minimum seats">
              <Input type="number" value={minUsers} onChange={(e) => setMinUsers(e.target.value)} min={1} />
            </F>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Maximum seats
                </Label>
                <UnlimitedButton active={maxUnlimited} onClick={() => setMaxUnlimited((v) => !v)} />
              </div>
              <Input
                type="number"
                value={maxUsersVal}
                onChange={(e) => setMaxUsersVal(e.target.value)}
                min={1}
                disabled={maxUnlimited}
                placeholder={maxUnlimited ? "Unlimited" : ""}
                className={maxUnlimited ? "bg-muted text-muted-foreground" : ""}
              />
            </div>
            <div /> {/* spacer */}

            <F label="Extra user / month">
              <EuroInput value={extraMonthly} onChange={setExtraMonthly} placeholder="15.00" />
            </F>
            <F label="Extra user / annual mo">
              <EuroInput value={extraAnnual} onChange={setExtraAnnual} placeholder="12.00" />
            </F>
          </TabsContent>

          {/* ─── Modules ─────────────────────────────────────────────────── */}
          <TabsContent value="modules" className="mt-0 space-y-4">
            <p className="text-xs text-muted-foreground">
              Select the product modules available on this plan. CRM is the baseline and should always be included.
            </p>
            <div className="grid grid-cols-2 gap-3">
              {ALL_MODULES.map((mod) => {
                const active = modules.has(mod.id);
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => toggleModule(mod.id)}
                    className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all ${
                      active
                        ? "border-primary bg-primary/5 ring-1 ring-primary"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors ${
                      active ? "border-primary bg-primary" : "border-muted-foreground/40"
                    }`}>
                      {active && (
                        <svg viewBox="0 0 10 10" className="h-3 w-3 text-primary-foreground">
                          <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${active ? "text-primary" : ""}`}>{mod.label}</p>
                      <p className="text-xs text-muted-foreground">{mod.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {modules.size} module{modules.size !== 1 ? "s" : ""} selected.
            </p>
          </TabsContent>

          {/* ─── Limits ──────────────────────────────────────────────────── */}
          <TabsContent value="limits" className="grid grid-cols-2 gap-x-4 gap-y-4 mt-0">
            <LimitField
              label="Max users"
              value={limits.maxUsers} unlimited={limits.maxUsersUnlimited} unit="users"
              onValue={(v) => patchLimit("maxUsers", v)} onUnlimited={(v) => patchLimit("maxUsersUnlimited", v)}
            />
            <LimitField
              label="API calls / month"
              value={limits.apiCallsPerMonth} unlimited={limits.apiCallsUnlimited} unit="calls"
              onValue={(v) => patchLimit("apiCallsPerMonth", v)} onUnlimited={(v) => patchLimit("apiCallsUnlimited", v)}
            />
            <F label="Storage">
              <SuffixInput value={limits.storageGb} onChange={(v) => patchLimit("storageGb", v)} suffix="GB" type="number" min={0} />
            </F>
            <LimitField
              label="Automation runs / month"
              value={limits.automationRunsPerMonth} unlimited={limits.automationUnlimited} unit="runs"
              onValue={(v) => patchLimit("automationRunsPerMonth", v)} onUnlimited={(v) => patchLimit("automationUnlimited", v)}
            />
            <LimitField
              label="Max records"
              value={limits.maxRecords} unlimited={limits.maxRecordsUnlimited} unit="records"
              onValue={(v) => patchLimit("maxRecords", v)} onUnlimited={(v) => patchLimit("maxRecordsUnlimited", v)}
            />
            <F label="Workspaces">
              <Input type="number" value={limits.maxWorkspaces} onChange={(e) => patchLimit("maxWorkspaces", e.target.value)} min={1} />
            </F>
            <LimitField
              label="Integrations"
              value={limits.maxIntegrations} unlimited={limits.maxIntegrationsUnlimited} unit="integrations"
              onValue={(v) => patchLimit("maxIntegrations", v)} onUnlimited={(v) => patchLimit("maxIntegrationsUnlimited", v)}
            />
          </TabsContent>

          {/* ─── Features ────────────────────────────────────────────────── */}
          <TabsContent value="features" className="grid grid-cols-2 gap-x-4 gap-y-4 mt-0">
            <div className="col-span-2">
              <F label="Support tier">
                <Select value={supportTier} onValueChange={setSupportTier}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORT_TIERS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        <span className="font-medium">{t.label}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{t.description}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </F>
            </div>
            <div className="col-span-2 space-y-2">
              <ToggleRow
                label="White Label"
                description="Custom domain, brand colors, and hidden Flux branding."
                checked={hasWhiteLabel}
                onChange={setHasWhiteLabel}
              />
              <ToggleRow
                label="Sandbox Environment"
                description="Isolated test instance mirroring the production tenant."
                checked={hasSandbox}
                onChange={setHasSandbox}
              />
            </div>
          </TabsContent>

          {/* ─── Stripe ──────────────────────────────────────────────────── */}
          <TabsContent value="stripe" className="grid grid-cols-2 gap-x-4 gap-y-4 mt-0">
            <p className="col-span-2 text-xs text-muted-foreground">
              Map this plan to Stripe products and prices. Leave blank if not yet configured in Stripe.
            </p>
            <div className="col-span-2">
              <F label="Product ID">
                <Input value={stripeProductId} onChange={(e) => setStripeProductId(e.target.value)} placeholder="prod_…" className="font-mono text-sm" />
              </F>
            </div>
            <F label="Monthly price ID">
              <Input value={stripePriceMonthlyId} onChange={(e) => setStripePriceMonthlyId(e.target.value)} placeholder="price_…" className="font-mono text-sm" />
            </F>
            <F label="Annual price ID">
              <Input value={stripePriceAnnualId} onChange={(e) => setStripePriceAnnualId(e.target.value)} placeholder="price_…" className="font-mono text-sm" />
            </F>
            <F label="Extra user monthly price ID">
              <Input value={stripeExtraUserMonthlyPriceId} onChange={(e) => setStripeExtraUserMonthlyPriceId(e.target.value)} placeholder="price_…" className="font-mono text-sm" />
            </F>
            <F label="Extra user annual price ID">
              <Input value={stripeExtraUserAnnualPriceId} onChange={(e) => setStripeExtraUserAnnualPriceId(e.target.value)} placeholder="price_…" className="font-mono text-sm" />
            </F>
          </TabsContent>

        </Tabs>
      </div>

      {/* ── Footer ── */}
      <div className="px-6 py-4 border-t bg-muted/30 flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {isEdit
            ? <>Editing <span className="font-medium text-foreground">{plan?.displayName}</span></>
            : "New plan will be created immediately."}
        </span>
        <div className="flex gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={pending} className="min-w-28">
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {pending ? "Saving…" : isEdit ? "Save Changes" : "Create Plan"}
          </Button>
        </div>
      </div>
    </form>
  );
}

// ─── Field wrapper ────────────────────────────────────────────────────────────

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </Label>
      {children}
    </div>
  );
}

// ─── Euro input ───────────────────────────────────────────────────────────────

function EuroInput({
  value, onChange, placeholder, disabled,
}: {
  value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground select-none">€</span>
      <Input
        type="number" value={value} onChange={(e) => onChange(e.target.value)}
        min={0} step="0.01" placeholder={placeholder} disabled={disabled}
        className={`pl-7 ${disabled ? "bg-muted text-muted-foreground" : ""}`}
      />
    </div>
  );
}

// ─── Suffix input ─────────────────────────────────────────────────────────────

function SuffixInput({
  value, onChange, suffix, type = "text", min, max,
}: {
  value: string; onChange: (v: string) => void; suffix: string;
  type?: string; min?: number; max?: number;
}) {
  return (
    <div className="relative">
      <Input
        type={type} value={value} onChange={(e) => onChange(e.target.value)}
        min={min} max={max} className="pr-10"
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground select-none">
        {suffix}
      </span>
    </div>
  );
}

// ─── Unlimited toggle button ──────────────────────────────────────────────────

function UnlimitedButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border transition-colors ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      <Infinity className="h-3 w-3" />
      Unlimited
    </button>
  );
}

// ─── Limit field ──────────────────────────────────────────────────────────────

function LimitField({
  label, value, unlimited, unit, onValue, onUnlimited,
}: {
  label: string; value: string; unlimited: boolean; unit: string;
  onValue: (v: string) => void; onUnlimited: (v: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</Label>
        <UnlimitedButton active={unlimited} onClick={() => onUnlimited(!unlimited)} />
      </div>
      <div className="relative">
        <Input
          type="number" value={value} onChange={(e) => onValue(e.target.value)}
          min={0} disabled={unlimited}
          placeholder={unlimited ? "Unlimited" : ""}
          className={`pr-20 ${unlimited ? "bg-muted text-muted-foreground" : ""}`}
        />
        {!unlimited && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground select-none">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Toggle row ───────────────────────────────────────────────────────────────

function ToggleRow({
  label, description, checked, onChange,
}: {
  label: string; description: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border px-4 py-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

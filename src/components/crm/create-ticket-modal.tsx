"use client";

import type React from "react";
import { useEffect, useState } from "react";

import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  ArrowDown,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Headphones,
  Loader2,
  Mail,
  MessageCircle,
  Minus,
  Phone,
  UserCheck,
  UserCircle,
  UserSearch,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { getCompaniesForSelect, getContactsForSelect, getLeadsForSelect } from "@/actions/crm";
import { createTicketAction } from "@/actions/support";
import { CreateTicketSchema } from "@/actions/support-validation";
import { AssigneeSelect, decodeAssignee, encodeAssignee } from "@/components/crm/assignee-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// ── Config ───────────────────────────────────────────────────────────────────

const CHANNELS = [
  {
    value: "email",
    icon: Mail,
    idle: "border-input hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/20",
    active: "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-500",
  },
  {
    value: "chat",
    icon: MessageCircle,
    idle: "border-input hover:border-green-400 hover:bg-green-50/50 dark:hover:bg-green-950/20",
    active:
      "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300 dark:border-green-500",
  },
  {
    value: "phone",
    icon: Phone,
    idle: "border-input hover:border-violet-400 hover:bg-violet-50/50 dark:hover:bg-violet-950/20",
    active:
      "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-500",
  },
  {
    value: "social",
    icon: Users,
    idle: "border-input hover:border-orange-400 hover:bg-orange-50/50 dark:hover:bg-orange-950/20",
    active:
      "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-500",
  },
] as const;

const PRIORITIES = [
  {
    value: "low",
    icon: ArrowDown,
    idle: "border-input hover:border-green-400 hover:bg-green-50/50 dark:hover:bg-green-950/20",
    active:
      "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300 dark:border-green-500",
    dot: "bg-green-500",
  },
  {
    value: "normal",
    icon: Minus,
    idle: "border-input hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/20",
    active: "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-500",
    dot: "bg-blue-500",
  },
  {
    value: "high",
    icon: Zap,
    idle: "border-input hover:border-orange-400 hover:bg-orange-50/50 dark:hover:bg-orange-950/20",
    active:
      "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-500",
    dot: "bg-orange-500",
  },
  {
    value: "urgent",
    icon: Zap,
    idle: "border-input hover:border-red-400 hover:bg-red-50/50 dark:hover:bg-red-950/20",
    active: "border-red-500 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300 dark:border-red-500",
    dot: "bg-red-500",
  },
] as const;

type RecordType = "contact" | "company" | "lead";
type ContactOption = { id: string; firstName: string | null; lastName: string | null; email: string | null };
type CompanyOption = { id: string; name: string };
type LeadOption = { id: string; firstName: string | null; lastName: string | null; email: string | null };
type AnyOption = { id: string; label: string; sub?: string };

const RECORD_TYPE_ICONS: Record<RecordType, React.ElementType> = {
  contact: UserCircle,
  company: Building2,
  lead: UserSearch,
};

function toOption(item: ContactOption | LeadOption): AnyOption {
  const name = [item.firstName, item.lastName].filter(Boolean).join(" ") || item.email || item.id;
  return { id: item.id, label: name, sub: item.email ?? undefined };
}

// ── Tags input ───────────────────────────────────────────────────────────────

function TagsInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const tag = input.trim().replace(/,/g, "");
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setInput("");
  };

  return (
    <div className="flex min-h-[38px] w-full flex-wrap gap-1.5 rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
      {value.map((tag) => (
        <Badge key={tag} variant="secondary" className="h-5 gap-1 pr-1 pl-2 font-normal text-xs">
          {tag}
          <button
            type="button"
            onClick={() => onChange(value.filter((t) => t !== tag))}
            className="rounded-sm opacity-60 hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag();
          }
          if (e.key === "Backspace" && !input && value.length > 0) onChange(value.slice(0, -1));
        }}
        onBlur={addTag}
        placeholder={value.length === 0 ? placeholder : ""}
        className="min-w-[120px] flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

// ── AnagraficaPicker ─────────────────────────────────────────────────────────

interface AnagraficaPickerProps {
  recordType: RecordType;
  onTypeChange: (t: RecordType) => void;
  options: AnyOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  popoverOpen: boolean;
  onPopoverOpenChange: (open: boolean) => void;
}

function AnagraficaPicker({
  recordType,
  onTypeChange,
  options,
  selectedId,
  onSelect,
  popoverOpen,
  onPopoverOpenChange,
}: AnagraficaPickerProps) {
  const t = useTranslations("support.tickets.createModal");
  const selectedOption = options.find((o) => o.id === selectedId) ?? null;
  const TypeIcon = RECORD_TYPE_ICONS[recordType];
  const RECORD_LABELS: Record<RecordType, string> = {
    contact: t("recordTypes.contact"),
    company: t("recordTypes.company"),
    lead: t("recordTypes.lead"),
  };
  const typeLabel = RECORD_LABELS[recordType];

  const recordTypes: { value: RecordType; icon: React.ElementType }[] = [
    { value: "contact", icon: UserCircle },
    { value: "company", icon: Building2 },
    { value: "lead", icon: UserSearch },
  ];

  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 font-medium text-sm">
        <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
        {t("linkToRecord")}
        <span className="font-normal text-muted-foreground">{t("optional")}</span>
      </p>

      {/* Type toggle */}
      <div className="flex overflow-hidden rounded-md border font-medium text-xs">
        {recordTypes.map((rt) => {
          const Icon = rt.icon;
          const active = recordType === rt.value;
          return (
            <button
              key={rt.value}
              type="button"
              onClick={() => {
                onTypeChange(rt.value);
                onPopoverOpenChange(false);
              }}
              className={cn(
                "flex flex-1 select-none items-center justify-center gap-1.5 px-2 py-1.5 transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                "not-last:border-r",
              )}
            >
              <Icon className="h-3 w-3 shrink-0" />
              {RECORD_LABELS[rt.value]}
            </button>
          );
        })}
      </div>

      {/* Searchable picker */}
      <Popover open={popoverOpen} onOpenChange={onPopoverOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={popoverOpen}
            className={cn(
              "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs",
              "transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
          >
            {selectedOption ? (
              <span className="flex min-w-0 items-center gap-2">
                <TypeIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{selectedOption.label}</span>
                {selectedOption.sub && (
                  <span className="truncate text-muted-foreground text-xs">{selectedOption.sub}</span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {t("linkToRecord")} {typeLabel.toLowerCase()}…
              </span>
            )}
            <div className="ml-2 flex shrink-0 items-center gap-1">
              {selectedOption && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(null);
                  }}
                  className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder={`${t("linkToRecord")} ${typeLabel.toLowerCase()}…`} />
            <CommandList>
              <CommandEmpty>{t("noResults")}</CommandEmpty>
              <CommandGroup>
                {options.map((opt) => (
                  <CommandItem
                    key={opt.id}
                    value={`${opt.label} ${opt.sub ?? ""}`}
                    onSelect={() => {
                      onSelect(opt.id === selectedId ? null : opt.id);
                      onPopoverOpenChange(false);
                    }}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{opt.label}</span>
                      {opt.sub && <span className="truncate text-muted-foreground text-xs">{opt.sub}</span>}
                    </span>
                    <Check className={cn("h-4 w-4 shrink-0", opt.id === selectedId ? "opacity-100" : "opacity-0")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

interface CreateTicketModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultContactId?: string;
  defaultCompanyId?: string;
  onSuccess?: (ticketId: string) => void;
}

export function CreateTicketModal({
  open,
  onOpenChange,
  defaultContactId,
  defaultCompanyId,
  onSuccess,
}: CreateTicketModalProps) {
  const router = useRouter();
  const t = useTranslations("support.tickets.createModal");
  const [isLoading, setIsLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [recordType, setRecordType] = useState<RecordType>("contact");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([]);
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);

  useEffect(() => {
    if (!open) return;
    getContactsForSelect().then(setContactOptions).catch(console.error);
    getCompaniesForSelect().then(setCompanyOptions).catch(console.error);
    getLeadsForSelect().then(setLeadOptions).catch(console.error);
  }, [open]);

  const currentOptions: AnyOption[] =
    recordType === "company"
      ? companyOptions.map((c) => ({ id: c.id, label: c.name }))
      : recordType === "lead"
        ? leadOptions.map((l) => toOption(l))
        : contactOptions.map((c) => toOption(c));

  const form = useForm<z.infer<typeof CreateTicketSchema>>({
    resolver: zodResolver(CreateTicketSchema),
    defaultValues: {
      subject: "",
      description: "",
      channel: "email",
      priority: "normal",
      severity: "normal",
      contactId: defaultContactId ?? undefined,
      companyId: defaultCompanyId ?? undefined,
      assigneeId: undefined,
      tags: [],
    },
  });

  const description = form.watch("description") ?? "";
  const DESC_LIMIT = 1000;

  const CHANNEL_LABELS: Record<string, string> = {
    email: t("channels.email"),
    chat: t("channels.chat"),
    phone: t("channels.phone"),
    social: t("channels.social"),
  };
  const PRIORITY_LABELS: Record<string, string> = {
    low: t("priorities.low"),
    normal: t("priorities.normal"),
    high: t("priorities.high"),
    urgent: t("priorities.urgent"),
  };

  async function onSubmit(data: z.infer<typeof CreateTicketSchema>) {
    setIsLoading(true);
    try {
      const result = await createTicketAction(data);
      onOpenChange(false);
      form.reset();
      setShowAdvanced(false);
      router.refresh();
      toast.success(t("successTitle", { number: result.ticketNumber }), {
        description: t("successDesc"),
        action: {
          label: t("viewTicket"),
          onClick: () => router.push(`/dashboard/support/tickets/${result.ticketId}`),
        },
      });
      onSuccess?.(result.ticketId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errorCreate"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!isLoading) {
          onOpenChange(v);
          if (!v) {
            form.reset();
            setShowAdvanced(false);
          }
        }
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[580px]">
        {/* Header */}
        <DialogHeader className="border-b bg-muted/30 px-4 md:px-6 pt-6 pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
              <Headphones className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="font-semibold text-lg">{t("title")}</DialogTitle>
              <DialogDescription className="mt-0.5 text-muted-foreground text-sm">{t("subtitle")}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Body */}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="max-h-[70dvh] space-y-5 overflow-y-auto px-4 md:px-6 py-5">
              {/* Subject */}
              <FormField
                control={form.control}
                name="subject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-medium text-sm">
                      {t("subjectLabel")} <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input placeholder={t("subjectPlaceholder")} className="h-10" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Linked record */}
              <AnagraficaPicker
                recordType={recordType}
                onTypeChange={(type) => {
                  setRecordType(type);
                  setPopoverOpen(false);
                  form.setValue("contactId", undefined);
                  form.setValue("companyId", undefined);
                  form.setValue("leadId", undefined);
                }}
                options={currentOptions}
                selectedId={
                  recordType === "contact"
                    ? (form.watch("contactId") ?? null)
                    : recordType === "company"
                      ? (form.watch("companyId") ?? null)
                      : (form.watch("leadId") ?? null)
                }
                onSelect={(id) => {
                  form.setValue("contactId", undefined);
                  form.setValue("companyId", undefined);
                  form.setValue("leadId", undefined);
                  if (id) {
                    if (recordType === "contact") form.setValue("contactId", id);
                    else if (recordType === "company") form.setValue("companyId", id);
                    else form.setValue("leadId", id);
                  }
                }}
                popoverOpen={popoverOpen}
                onPopoverOpenChange={setPopoverOpen}
              />

              {/* Assign to */}
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 font-medium text-sm">
                  <UserCheck className="h-3.5 w-3.5 text-muted-foreground" />
                  {t("assignTo")}
                  <span className="font-normal text-muted-foreground">{t("optional")}</span>
                </p>
                <AssigneeSelect
                  value={encodeAssignee(form.watch("assigneeId"), null)}
                  onChange={(encoded) => {
                    const { ownerId } = decodeAssignee(encoded);
                    form.setValue("assigneeId", ownerId ?? undefined);
                  }}
                />
              </div>

              {/* Channel */}
              <FormField
                control={form.control}
                name="channel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-medium text-sm">{t("channelLabel")}</FormLabel>
                    <FormControl>
                      <div className="grid grid-cols-4 gap-2">
                        {CHANNELS.map((ch) => {
                          const Icon = ch.icon;
                          const isSelected = field.value === ch.value;
                          return (
                            <button
                              key={ch.value}
                              type="button"
                              onClick={() => field.onChange(ch.value)}
                              className={cn(
                                "flex cursor-pointer select-none flex-col items-center gap-1.5 rounded-lg border px-2 py-3 font-medium text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                isSelected ? ch.active : ch.idle,
                              )}
                            >
                              <Icon className="h-4 w-4" />
                              {CHANNEL_LABELS[ch.value]}
                            </button>
                          );
                        })}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Priority */}
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="font-medium text-sm">{t("priorityLabel")}</FormLabel>
                    <FormControl>
                      <div className="grid grid-cols-4 gap-2">
                        {PRIORITIES.map((p) => {
                          const Icon = p.icon;
                          const isSelected = field.value === p.value;
                          return (
                            <button
                              key={p.value}
                              type="button"
                              onClick={() => field.onChange(p.value)}
                              className={cn(
                                "flex cursor-pointer select-none flex-col items-center gap-1.5 rounded-lg border px-2 py-3 font-medium text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                isSelected ? p.active : p.idle,
                              )}
                            >
                              <div className="flex items-center gap-1">
                                {isSelected && <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", p.dot)} />}
                                <Icon className="h-3.5 w-3.5" />
                              </div>
                              {PRIORITY_LABELS[p.value]}
                            </button>
                          );
                        })}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel className="font-medium text-sm">
                        {t("descriptionLabel")}{" "}
                        <span className="font-normal text-muted-foreground">{t("optional")}</span>
                      </FormLabel>
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          description.length > DESC_LIMIT * 0.9 ? "text-orange-500" : "text-muted-foreground",
                        )}
                      >
                        {description.length} / {DESC_LIMIT}
                      </span>
                    </div>
                    <FormControl>
                      <Textarea
                        placeholder={t("descriptionPlaceholder")}
                        className="min-h-[88px] resize-none text-sm"
                        maxLength={DESC_LIMIT}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Advanced options */}
              <div className="overflow-hidden rounded-lg border">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="flex w-full items-center justify-between px-4 py-2.5 font-medium text-muted-foreground text-sm transition-colors hover:bg-muted/50 hover:text-foreground"
                >
                  <span>{t("advancedOptions")}</span>
                  {showAdvanced ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>

                {showAdvanced && (
                  <div className="space-y-4 border-t bg-muted/20 px-4 pt-1 pb-4">
                    {/* Severity */}
                    <FormField
                      control={form.control}
                      name="severity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                            {t("severityLabel")}
                          </FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-9">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="low">{t("severity.low")}</SelectItem>
                              <SelectItem value="normal">{t("severity.normal")}</SelectItem>
                              <SelectItem value="high">{t("severity.high")}</SelectItem>
                              <SelectItem value="critical">{t("severity.critical")}</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Tags */}
                    <FormField
                      control={form.control}
                      name="tags"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                            {t("tagsLabel")}
                          </FormLabel>
                          <FormControl>
                            <TagsInput
                              value={field.value}
                              onChange={field.onChange}
                              placeholder={t("tagsPlaceholder")}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-6 py-4">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  form.reset();
                  setShowAdvanced(false);
                }}
                disabled={isLoading}
              >
                {t("cancelButton")}
              </Button>
              <Button type="submit" size="sm" disabled={isLoading} className="min-w-[130px] gap-2">
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("creatingButton")}
                  </>
                ) : (
                  <>
                    <Headphones className="h-4 w-4" />
                    {t("openTicketButton")}
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

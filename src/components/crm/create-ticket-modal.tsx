"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
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
  UserCircle,
  UserSearch,
  Users,
  X,
  Zap,
} from "lucide-react";
import { getContactsForSelect, getCompaniesForSelect, getLeadsForSelect } from "@/actions/crm";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { createTicketAction } from "@/actions/support";
import { CreateTicketSchema } from "@/actions/support-validation";

// ── Visual option configs ────────────────────────────────────────────────────

const CHANNELS = [
  {
    value: "email",
    label: "Email",
    icon: Mail,
    idle: "border-input hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/20",
    active: "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-500",
  },
  {
    value: "chat",
    label: "Chat",
    icon: MessageCircle,
    idle: "border-input hover:border-green-400 hover:bg-green-50/50 dark:hover:bg-green-950/20",
    active: "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300 dark:border-green-500",
  },
  {
    value: "phone",
    label: "Phone",
    icon: Phone,
    idle: "border-input hover:border-violet-400 hover:bg-violet-50/50 dark:hover:bg-violet-950/20",
    active: "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-500",
  },
  {
    value: "social",
    label: "Social",
    icon: Users,
    idle: "border-input hover:border-orange-400 hover:bg-orange-50/50 dark:hover:bg-orange-950/20",
    active: "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-500",
  },
] as const;

const PRIORITIES = [
  {
    value: "low",
    label: "Low",
    icon: ArrowDown,
    idle: "border-input hover:border-green-400 hover:bg-green-50/50 dark:hover:bg-green-950/20",
    active: "border-green-500 bg-green-50 text-green-700 dark:bg-green-950/30 dark:text-green-300 dark:border-green-500",
    dot: "bg-green-500",
  },
  {
    value: "normal",
    label: "Normal",
    icon: Minus,
    idle: "border-input hover:border-blue-400 hover:bg-blue-50/50 dark:hover:bg-blue-950/20",
    active: "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-500",
    dot: "bg-blue-500",
  },
  {
    value: "high",
    label: "High",
    icon: Zap,
    idle: "border-input hover:border-orange-400 hover:bg-orange-50/50 dark:hover:bg-orange-950/20",
    active: "border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-500",
    dot: "bg-orange-500",
  },
  {
    value: "urgent",
    label: "Urgent",
    icon: Zap,
    idle: "border-input hover:border-red-400 hover:bg-red-50/50 dark:hover:bg-red-950/20",
    active: "border-red-500 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300 dark:border-red-500",
    dot: "bg-red-500",
  },
] as const;

// ── Tags input ───────────────────────────────────────────────────────────────

function TagsInput({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [input, setInput] = useState("");

  const addTag = () => {
    const tag = input.trim().replace(/,/g, "");
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setInput("");
  };

  return (
    <div className="flex flex-wrap gap-1.5 min-h-[38px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
      {value.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="h-5 gap-1 pl-2 pr-1 text-xs font-normal"
        >
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
          if (e.key === "Backspace" && !input && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={addTag}
        placeholder={value.length === 0 ? "Add tags… press Enter to confirm" : ""}
        className="flex-1 min-w-[120px] bg-transparent outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

// ── Anagrafica picker ────────────────────────────────────────────────────────

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
  const selectedOption = options.find((o) => o.id === selectedId) ?? null;
  const TypeIcon = RECORD_TYPES.find((t) => t.value === recordType)?.icon ?? UserCircle;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium flex items-center gap-1.5">
        <TypeIcon className="h-3.5 w-3.5 text-muted-foreground" />
        Link to record
        <span className="text-muted-foreground font-normal">(optional)</span>
      </label>

      {/* Type toggle */}
      <div className="flex rounded-md border overflow-hidden text-xs font-medium">
        {RECORD_TYPES.map((rt) => {
          const Icon = rt.icon;
          const active = recordType === rt.value;
          return (
            <button
              key={rt.value}
              type="button"
              onClick={() => onTypeChange(rt.value)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 py-1.5 px-2 transition-colors select-none",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                "not-last:border-r"
              )}
            >
              <Icon className="h-3 w-3 shrink-0" />
              {rt.label}
            </button>
          );
        })}
      </div>

      {/* Searchable record picker */}
      <Popover open={popoverOpen} onOpenChange={onPopoverOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={popoverOpen}
            className={cn(
              "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs ring-offset-background",
              "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "transition-colors"
            )}
          >
            {selectedOption ? (
              <span className="flex items-center gap-2 min-w-0">
                <TypeIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="truncate font-medium">{selectedOption.label}</span>
                {selectedOption.sub && (
                  <span className="text-muted-foreground truncate text-xs">{selectedOption.sub}</span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">Search {RECORD_TYPES.find((t) => t.value === recordType)?.label.toLowerCase()}…</span>
            )}
            <div className="flex items-center gap-1 ml-2 shrink-0">
              {selectedOption && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onSelect(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onSelect(null); } }}
                  className="rounded-sm p-0.5 hover:bg-muted text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </span>
              )}
              <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            <CommandInput placeholder={`Search ${RECORD_TYPES.find((t) => t.value === recordType)?.label.toLowerCase()}…`} />
            <CommandList>
              <CommandEmpty>No results found.</CommandEmpty>
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
                    <span className="flex flex-col min-w-0">
                      <span className="truncate font-medium">{opt.label}</span>
                      {opt.sub && <span className="text-xs text-muted-foreground truncate">{opt.sub}</span>}
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

type RecordType = "contact" | "company" | "lead";
type ContactOption = { id: string; firstName: string | null; lastName: string | null; email: string | null };
type CompanyOption = { id: string; name: string };
type LeadOption = { id: string; firstName: string | null; lastName: string | null; email: string | null };
type AnyOption = { id: string; label: string; sub?: string };

const RECORD_TYPES: { value: RecordType; label: string; icon: React.ElementType }[] = [
  { value: "contact", label: "Contact", icon: UserCircle },
  { value: "company", label: "Company", icon: Building2 },
  { value: "lead", label: "Lead", icon: UserSearch },
];

function toOption(item: ContactOption | LeadOption, _type: "contact" | "lead"): AnyOption {
  const name = [item.firstName, item.lastName].filter(Boolean).join(" ") || item.email || item.id;
  return { id: item.id, label: name, sub: item.email ?? undefined };
}

export function CreateTicketModal({
  open,
  onOpenChange,
  defaultContactId,
  defaultCompanyId,
  onSuccess,
}: CreateTicketModalProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Anagrafica state
  const [recordType, setRecordType] = useState<RecordType>("contact");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([]);
  const [companyOptions, setCompanyOptions] = useState<CompanyOption[]>([]);
  const [leadOptions, setLeadOptions] = useState<LeadOption[]>([]);

  useEffect(() => {
    if (!open) return;
    getContactsForSelect().then(setContactOptions).catch(() => {});
    getCompaniesForSelect().then(setCompanyOptions).catch(() => {});
    getLeadsForSelect().then(setLeadOptions).catch(() => {});
  }, [open]);

  // Build the flat option list for the current type
  const currentOptions: AnyOption[] = recordType === "company"
    ? companyOptions.map((c) => ({ id: c.id, label: c.name }))
    : recordType === "lead"
      ? leadOptions.map((l) => toOption(l, "lead"))
      : contactOptions.map((c) => toOption(c, "contact"));

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
      tags: [],
    },
  });

  const description = form.watch("description") ?? "";
  const tags = form.watch("tags") ?? [];
  const DESC_LIMIT = 1000;

  async function onSubmit(data: z.infer<typeof CreateTicketSchema>) {
    setIsLoading(true);
    try {
      const result = await createTicketAction(data);
      onOpenChange(false);
      form.reset();
      setShowAdvanced(false);

      router.refresh();

      toast.success(`Ticket ${result.ticketNumber} opened`, {
        description: "Your support ticket has been created.",
        action: {
          label: "View ticket",
          onClick: () => router.push(`/dashboard/support/tickets/${result.ticketId}`),
        },
      });

      onSuccess?.(result.ticketId);
    } catch (error: any) {
      toast.error(error.message ?? "Failed to create ticket");
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
          if (!v) { form.reset(); setShowAdvanced(false); }
        }
      }}
    >
      <DialogContent className="sm:max-w-[580px] p-0 gap-0 overflow-hidden">
        {/* ── Colored header ── */}
        <DialogHeader className="px-6 pt-6 pb-5 border-b bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Headphones className="h-5 w-5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-lg font-semibold">
                New Support Ticket
              </DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground mt-0.5">
                Open a new case or customer issue for your team
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* ── Form body ── */}
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">

              {/* Subject */}
              <FormField
                control={form.control}
                name="subject"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Subject <span className="text-destructive">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="Briefly describe the issue…"
                        className="h-10"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* ── Linked record (anagrafica) ── */}
              <AnagraficaPicker
                recordType={recordType}
                onTypeChange={(t) => {
                  setRecordType(t);
                  setPopoverOpen(false);
                  form.setValue("contactId", undefined);
                  form.setValue("companyId", undefined);
                  form.setValue("leadId", undefined);
                }}
                options={currentOptions}
                selectedId={
                  recordType === "contact" ? (form.watch("contactId") ?? null)
                  : recordType === "company" ? (form.watch("companyId") ?? null)
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

              {/* Channel */}
              <FormField
                control={form.control}
                name="channel"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">Channel</FormLabel>
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
                                "flex flex-col items-center gap-1.5 rounded-lg border py-3 px-2 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                isSelected ? ch.active : ch.idle,
                                "cursor-pointer select-none"
                              )}
                            >
                              <Icon className="h-4 w-4" />
                              {ch.label}
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
                    <FormLabel className="text-sm font-medium">Priority</FormLabel>
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
                                "flex flex-col items-center gap-1.5 rounded-lg border py-3 px-2 text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                isSelected ? p.active : p.idle,
                                "cursor-pointer select-none"
                              )}
                            >
                              <div className="flex items-center gap-1">
                                {isSelected && (
                                  <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", p.dot)} />
                                )}
                                <Icon className="h-3.5 w-3.5" />
                              </div>
                              {p.label}
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
                      <FormLabel className="text-sm font-medium">
                        Description{" "}
                        <span className="text-muted-foreground font-normal">(optional)</span>
                      </FormLabel>
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          description.length > DESC_LIMIT * 0.9
                            ? "text-orange-500"
                            : "text-muted-foreground"
                        )}
                      >
                        {description.length} / {DESC_LIMIT}
                      </span>
                    </div>
                    <FormControl>
                      <Textarea
                        placeholder="Provide additional context, steps to reproduce, or expected vs. actual behaviour…"
                        className="resize-none text-sm min-h-[88px]"
                        maxLength={DESC_LIMIT}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Advanced options (collapsible) */}
              <div className="rounded-lg border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                >
                  <span>Advanced options</span>
                  {showAdvanced ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </button>

                {showAdvanced && (
                  <div className="px-4 pb-4 pt-1 space-y-4 border-t bg-muted/20">
                    {/* Severity */}
                    <FormField
                      control={form.control}
                      name="severity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Severity
                          </FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-9">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="low">Low — Minor inconvenience</SelectItem>
                              <SelectItem value="normal">Normal — Standard issue</SelectItem>
                              <SelectItem value="high">High — Business impact</SelectItem>
                              <SelectItem value="critical">Critical — System down</SelectItem>
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
                          <FormLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            Tags
                          </FormLabel>
                          <FormControl>
                            <TagsInput value={field.value} onChange={field.onChange} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* ── Footer ── */}
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-t bg-muted/20">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => { onOpenChange(false); form.reset(); setShowAdvanced(false); }}
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isLoading} className="gap-2 min-w-[130px]">
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Headphones className="h-4 w-4" />
                    Open Ticket
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

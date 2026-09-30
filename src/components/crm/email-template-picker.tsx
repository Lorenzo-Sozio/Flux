"use client";

import { useState } from "react";

import Link from "next/link";

import { FileTextIcon, Settings2Icon, UsersIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ComposerTemplate } from "@/lib/email-template-rules";

/**
 * Which template an email starts from: searchable, one-to-one templates first — mine, then the
 * team's — and the campaign ones after, each with its subject so the right one is recognised.
 */
export function EmailTemplatePicker({
  templates,
  onPick,
}: {
  templates: ComposerTemplate[];
  onPick: (template: ComposerTemplate) => void;
}) {
  const t = useTranslations("emailTemplates.picker");
  const tc = useTranslations("emailTemplates.categories");
  const [open, setOpen] = useState(false);

  const mine = templates.filter((tpl) => tpl.kind === "personal" && tpl.mine);
  const team = templates.filter((tpl) => tpl.kind === "personal" && !tpl.mine);
  const campaign = templates.filter((tpl) => tpl.kind === "campaign");
  const category = (c: string) => (tc.has(c as never) ? tc(c as never) : null);

  const group = (heading: string, items: ComposerTemplate[]) =>
    items.length > 0 ? (
      <CommandGroup heading={heading}>
        {items.map((tpl) => (
          <CommandItem
            key={tpl.id}
            value={`${tpl.name} ${tpl.subject} ${tpl.id}`}
            onSelect={() => {
              onPick(tpl);
              setOpen(false);
            }}
            className="flex-col items-start gap-0.5"
          >
            <span className="flex w-full items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">{tpl.name}</span>
              {tpl.kind === "personal" && category(tpl.category) ? (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {category(tpl.category)}
                </span>
              ) : null}
              {tpl.kind === "personal" && tpl.isPublic && tpl.mine ? (
                <UsersIcon className="size-3 shrink-0 text-muted-foreground" aria-label={t("shared")} />
              ) : null}
            </span>
            <span className="w-full truncate text-muted-foreground text-xs">{tpl.subject}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    ) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-expanded={open}>
          <FileTextIcon className="text-muted-foreground" />
          {t("trigger")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))] p-0">
        <Command>
          <CommandInput placeholder={t("search")} />
          <CommandList className="max-h-80">
            <CommandEmpty>{templates.length === 0 ? t("none") : t("noMatch")}</CommandEmpty>
            {group(t("mine"), mine)}
            {group(t("team"), team)}
            {group(t("campaign"), campaign)}
          </CommandList>
          <CommandSeparator />
          <div className="p-1">
            <Button asChild variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
              <Link href="/dashboard/settings/email-templates">
                <Settings2Icon />
                {t("manage")}
              </Link>
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

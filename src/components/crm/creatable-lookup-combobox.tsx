"use client";

import { useState } from "react";

import { Check, ChevronsUpDown, PlusCircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";
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

export interface LookupItem {
  id: string;
  name: string;
}

interface CreatableLookupComboboxProps {
  value: string | null;
  onChange: (id: string | null) => void;
  items: LookupItem[];
  onAddItem: (item: LookupItem) => void;
  onCreate: (name: string) => Promise<LookupItem>;
  placeholder?: string;
  searchPlaceholder?: string;
  createPrefix?: string;
  clearLabel?: string;
  creatingLabel?: string;
  disabled?: boolean;
}

export function CreatableLookupCombobox({
  value,
  onChange,
  items,
  onAddItem,
  onCreate,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  createPrefix = "Create",
  clearLabel = "Clear selection",
  creatingLabel = "Creating…",
  disabled = false,
}: CreatableLookupComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);

  const selected = items.find((i) => i.id === value);

  const trimmed = search.trim();
  const filtered = trimmed
    ? items.filter((i) => i.name.toLowerCase().includes(trimmed.toLowerCase()))
    : items;

  const hasExactMatch = items.some((i) => i.name.toLowerCase() === trimmed.toLowerCase());
  const showCreate = trimmed.length > 0 && !hasExactMatch;

  const close = () => {
    setOpen(false);
    setSearch("");
  };

  const handleSelect = (id: string | null) => {
    onChange(id);
    close();
  };

  const handleCreate = async () => {
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const newItem = await onCreate(trimmed);
      onAddItem(newItem);
      onChange(newItem.id);
      close();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !selected && "text-muted-foreground")}
        >
          <span className="truncate">{selected ? selected.name : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
          <CommandList>
            {filtered.length === 0 && !showCreate && (
              <CommandEmpty>No results found.</CommandEmpty>
            )}
            <CommandGroup>
              {value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => handleSelect(null)}
                  className="text-muted-foreground italic text-xs"
                >
                  — {clearLabel}
                </CommandItem>
              )}
              {filtered.map((item) => (
                <CommandItem key={item.id} value={item.id} onSelect={() => handleSelect(item.id)}>
                  <Check
                    className={cn("mr-2 h-4 w-4 shrink-0", value === item.id ? "opacity-100" : "opacity-0")}
                  />
                  {item.name}
                </CommandItem>
              ))}
            </CommandGroup>
            {showCreate && (
              <>
                {filtered.length > 0 && <CommandSeparator />}
                <CommandGroup>
                  <CommandItem
                    value="__create__"
                    onSelect={handleCreate}
                    disabled={creating}
                    className="gap-2 text-primary"
                  >
                    <PlusCircleIcon className="h-4 w-4 shrink-0" />
                    {creating ? creatingLabel : `${createPrefix} "${trimmed}"`}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

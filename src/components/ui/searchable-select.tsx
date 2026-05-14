"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface SearchableSelectOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}

function useScrollWheel(ref: React.RefObject<HTMLDivElement | null>, open: boolean) {
  React.useEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!el.contains(e.target as Node)) return;
      e.preventDefault();
      const px = e.deltaMode === 0 ? e.deltaY : e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY * el.clientHeight;
      el.scrollTop += px;
    };
    // Capture phase fires before react-remove-scroll's document-level bubble handler
    document.addEventListener("wheel", handler, { passive: false, capture: true });
    return () => document.removeEventListener("wheel", handler, { capture: true });
  }, [open, ref]);
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results found.",
  disabled = false,
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useScrollWheel(scrollRef, open);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <div
            ref={scrollRef}
            className="max-h-[280px] overflow-y-auto overflow-x-hidden"
            style={{ scrollbarWidth: "thin" }}
          >
            <CommandList className="max-h-none overflow-visible">
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    data-checked={value === option.value}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="truncate">{option.label}</p>
                      {option.sublabel && (
                        <p className="text-xs text-muted-foreground truncate">
                          {option.sublabel}
                        </p>
                      )}
                    </div>
                    <Check
                      className={cn(
                        "ml-2 h-4 w-4 shrink-0",
                        value === option.value ? "opacity-100" : "opacity-0"
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

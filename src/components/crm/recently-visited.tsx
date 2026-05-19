"use client";

import { useCallback, useEffect, useState } from "react";

import Link from "next/link";

import { Building2, History, Kanban, Trash2, User, UserCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

import type { HistoryItem } from "./record-visit";

const STORAGE_KEY = "flux_crm_history";

const TYPE_CONFIG: Record<HistoryItem["type"], { label: string; icon: React.ElementType; color: string }> = {
  contact: {
    label: "Contact",
    icon: User,
    color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  lead: {
    label: "Lead",
    icon: UserCheck,
    color: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  },
  company: {
    label: "Company",
    icon: Building2,
    color: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  },
  deal: {
    label: "Deal",
    icon: Kanban,
    color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function RecentlyVisited() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      setItems(raw ? JSON.parse(raw) : []);
    } catch {
      setItems([]);
    }
  }, []);

  // Load on open so it's always fresh
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const clearHistory = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
      setItems([]);
    } catch {}
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8" title="Recently visited">
          <History className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="flex items-center justify-between py-3">
          <span>Recently Visited</span>
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 text-xs text-muted-foreground hover:text-destructive"
              onClick={clearHistory}
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ScrollArea className="max-h-80">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <History className="mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No recent records</p>
            </div>
          ) : (
            <div className="divide-y">
              {items.map((item) => {
                const cfg = TYPE_CONFIG[item.type];
                const Icon = cfg.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors"
                  >
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px]",
                        cfg.color,
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <p className="text-[10px] text-muted-foreground">{cfg.label}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(item.visitedAt)}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

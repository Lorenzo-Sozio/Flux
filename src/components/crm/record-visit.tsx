"use client";

import { useEffect } from "react";

export type HistoryItem = {
  type: "contact" | "lead" | "company" | "deal";
  name: string;
  href: string;
  visitedAt: number;
};

const STORAGE_KEY = "flux_crm_history";
const MAX_ITEMS = 15;

export function RecordVisit({ type, name, href }: { type: HistoryItem["type"]; name: string; href: string }) {
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const existing: HistoryItem[] = raw ? JSON.parse(raw) : [];
      const filtered = existing.filter((item) => item.href !== href);
      const next: HistoryItem[] = [{ type, name, href, visitedAt: Date.now() }, ...filtered].slice(0, MAX_ITEMS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // localStorage may be unavailable (private browsing, SSR guard)
    }
  }, [type, name, href]);

  return null;
}

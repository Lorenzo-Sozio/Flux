"use client";

import { createContext, type ReactNode, useContext, useEffect } from "react";

/**
 * The workspace the browser is in, for what is kept on the device.
 *
 * ⚠️ Recents were stored under one key for the whole browser, so somebody working
 * in two workspaces saw the first one's records listed in the second — names and
 * all — and opening one landed on a page that belonged to the other workspace.
 */
const ScopeContext = createContext<string | null>(null);

/** Keys that were global, from before recents were kept per workspace. */
const LEGACY_KEYS = ["flux.recent-records", "flux_crm_history"];

export function WorkspaceScopeProvider({ scope, children }: { scope: string; children: ReactNode }) {
  useEffect(() => {
    try {
      for (const key of LEGACY_KEYS) window.localStorage.removeItem(key);
    } catch {
      // Storage refused: there is nothing stored to clean up either.
    }
  }, []);
  return <ScopeContext.Provider value={scope}>{children}</ScopeContext.Provider>;
}

export function useWorkspaceScope(): string | null {
  return useContext(ScopeContext);
}

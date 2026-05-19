"use client";

import type { ReactNode } from "react";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";

export function SessionProvider({ children }: { children: ReactNode }) {
  return <NextAuthSessionProvider>{children}</NextAuthSessionProvider>;
}

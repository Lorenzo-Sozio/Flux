"use client";

import { useEffect, useState } from "react";

import { Check, Copy, KeyRound, Wand2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

import { DEMO_EMAIL, DEMO_PASSWORD, requestDemoFill } from "./demo-credentials";

export function DemoCredentialsBanner() {
  const t = useTranslations("auth.demoCredentials");
  const [mounted, setMounted] = useState(false);
  const [copied, setCopied] = useState<"email" | "password" | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  const copy = (value: string, field: "email" | "password") => {
    navigator.clipboard.writeText(value);
    setCopied(field);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950/40">
      <div className="mb-2 flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">{t("title")}</span>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 rounded bg-white/60 px-2.5 py-1.5 dark:bg-black/20">
          <div className="min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-blue-500 dark:text-blue-400">Email</span>
            <p className="font-mono text-sm text-blue-900 dark:text-blue-100">{DEMO_EMAIL}</p>
          </div>
          <button
            type="button"
            onClick={() => copy(DEMO_EMAIL, "email")}
            className="shrink-0 text-blue-400 hover:text-blue-600 transition-colors"
            aria-label={t("copyEmail")}
          >
            {copied === "email" ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 rounded bg-white/60 px-2.5 py-1.5 dark:bg-black/20">
          <div className="min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-blue-500 dark:text-blue-400">
              {t("password")}
            </span>
            <p className="font-mono text-sm text-blue-900 dark:text-blue-100">{DEMO_PASSWORD}</p>
          </div>
          <button
            type="button"
            onClick={() => copy(DEMO_PASSWORD, "password")}
            className="shrink-0 text-blue-400 hover:text-blue-600 transition-colors"
            aria-label={t("copyPassword")}
          >
            {copied === "password" ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={requestDemoFill}
        className="mt-2.5 w-full gap-1.5 border-blue-200 bg-white/70 text-blue-700 hover:bg-white dark:border-blue-800 dark:bg-black/20 dark:text-blue-200"
      >
        <Wand2 className="h-3.5 w-3.5" />
        {t("fill")}
      </Button>
    </div>
  );
}

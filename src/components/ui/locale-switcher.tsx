"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Check, Globe } from "lucide-react";

import { setLocale } from "@/actions/locale";
import { locales, localeLabels } from "@/i18n/config";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export function LocaleSwitcher() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const currentLocale = useLocale();

  const handleChange = (locale: string) => {
    startTransition(async () => {
      await setLocale(locale);
      router.refresh();
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn("h-8 w-8", isPending && "opacity-50")}
          disabled={isPending}
          title="Change language"
        >
          <Globe className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {locales.map((locale) => {
          const { label, flag } = localeLabels[locale];
          return (
            <DropdownMenuItem
              key={locale}
              onClick={() => handleChange(locale)}
              className="gap-2 cursor-pointer"
            >
              <span className="text-base leading-none">{flag}</span>
              <span className="flex-1">{label}</span>
              {currentLocale === locale && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

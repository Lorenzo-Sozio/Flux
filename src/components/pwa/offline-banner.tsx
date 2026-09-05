"use client";

import { useEffect, useState } from "react";

import { CloudOff } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Says when the network is gone, because nothing else will.
 *
 * The service worker caches no data on purpose, so an offline CRM is a CRM that
 * cannot answer — and the failure a person actually meets is a save that does
 * nothing, or a list that stays a skeleton. Neither says why. This does.
 *
 * ⚠️ `navigator.onLine` is a weak signal: it means "there is a network
 * interface", not "the server can be reached". It is trustworthy in one
 * direction only — false really does mean no requests will succeed — which is
 * the direction this is used in. A hotel wifi that answers DHCP and nothing else
 * still reads as online, and there the failing request's own error message is
 * what has to carry the news.
 */
export function OfflineBanner() {
  const t = useTranslations("pwa");
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  if (!offline) return null;

  return (
    <output
      aria-live="polite"
      className="flex shrink-0 items-center justify-center gap-2 bg-amber-500/15 px-4 py-1.5 text-amber-900 text-xs dark:text-amber-200"
    >
      <CloudOff className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate">{t("offlineBanner")}</span>
    </output>
  );
}

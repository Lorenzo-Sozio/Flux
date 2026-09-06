"use client";

import { useEffect, useState } from "react";

import { RefreshCw, WifiOff } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The two sentences, in the two languages the product speaks.
 *
 * ⚠️ Not next-intl, and not `<html lang>` either. This page is written to the
 * cache once, at install, and served from there forever after — so **anything
 * the server decided is frozen at that moment**, including the locale and the
 * lang attribute that came with it. Somebody who installs the app in English
 * and switches to Italian would keep getting the English page.
 *
 * The cookie is not frozen: it is read at the moment this renders. So that is
 * what decides, and `<html lang>` is only the fallback for a first visit that
 * has not set one.
 */
const COPY = {
  it: {
    title: "Nessuna connessione",
    body: "Flux ha bisogno della rete per mostrare dati aggiornati. I dati del CRM non vengono conservati sul telefono, così quello che leggi è sempre quello che c'è davvero.",
    retry: "Riprova",
    waiting: "In attesa della rete…",
  },
  en: {
    title: "No connection",
    body: "Flux needs the network to show current data. Nothing from the CRM is kept on the phone, so what you read is always what is actually there.",
    retry: "Try again",
    waiting: "Waiting for the network…",
  },
} as const;

export function OfflineNotice() {
  const [copy, setCopy] = useState<(typeof COPY)[keyof typeof COPY]>(COPY.en);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const cookie = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/)?.[1];
    const lang = (cookie ?? document.documentElement.lang ?? "").slice(0, 2);
    setCopy(lang === "it" ? COPY.it : COPY.en);

    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return (
    <div className="w-full max-w-sm space-y-5 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-muted">
        <WifiOff className="size-6 text-muted-foreground" aria-hidden />
      </div>

      <div className="space-y-2">
        <h1 className="font-semibold text-xl tracking-tight">{copy.title}</h1>
        <p className="text-balance text-muted-foreground text-sm leading-relaxed">{copy.body}</p>
      </div>

      <Button
        type="button"
        size="lg"
        className="w-full"
        onClick={() => window.location.reload()}
        // Retrying with no network reloads straight back to this page, which
        // reads as a broken button. The label says what is happening instead.
        disabled={!online}
      >
        <RefreshCw className="size-4" aria-hidden />
        {online ? copy.retry : copy.waiting}
      </Button>
    </div>
  );
}

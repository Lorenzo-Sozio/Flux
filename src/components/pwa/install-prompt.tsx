"use client";

import { useEffect, useState } from "react";

import { Download, Share, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

/**
 * The offer to install, on a phone, once.
 *
 * Two browsers, two different mechanics:
 *
 *   • Chrome and the Chromium browsers fire `beforeinstallprompt`, which can be
 *     saved and replayed later from a real user gesture. That is the only way to
 *     show the native install sheet at a moment that makes sense rather than the
 *     moment the page loads.
 *   • iOS Safari fires nothing and has no API at all. Installing is Share → Add
 *     to Home Screen, and the only thing a page can do is say so. So on iOS this
 *     shows the instruction instead of a button that would do nothing.
 *
 * ⚠️ Dismissal is remembered. An install banner that comes back every visit is
 * the reason people stop reading banners, and the browser's own install button
 * stays in the address bar for anyone who changes their mind.
 */
const DISMISSED_KEY = "flux.install-prompt.dismissed";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // The Chromium answer, then the one iOS has had since long before it.
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // Chrome and Firefox on iOS cannot install either, and their share sheets do
  // not carry the item, so telling them to use it would be wrong.
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

export function InstallPrompt() {
  const t = useTranslations("pwa");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;

    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // Private mode, or storage blocked. Showing the banner once per visit is a
      // better failure than never showing it.
    }
    if (dismissed) return;

    if (isIosSafari()) {
      setShowIosHint(true);
      return;
    }

    const onPrompt = (event: Event) => {
      // Without this the browser shows its own mini-infobar at its own moment.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    // Installed from the banner or from the address bar — either way, it is done.
    const onInstalled = () => setDeferred(null);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function dismiss() {
    setDeferred(null);
    setShowIosHint(false);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Nothing to do: it simply reappears next visit.
    }
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    // The saved event is single-use, whichever way the answer went.
    dismiss();
  }

  if (!deferred && !showIosHint) return null;

  return (
    <section
      className="fixed inset-x-0 bottom-[calc(var(--mobile-nav-height)+var(--safe-bottom))] z-30 border-t bg-background/95 p-3 backdrop-blur-md md:hidden"
      aria-label={t("installTitle")}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {showIosHint ? <Share className="size-4" aria-hidden /> : <Download className="size-4" aria-hidden />}
        </div>

        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm">{t("installTitle")}</p>
          <p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">
            {showIosHint ? t("iosInstallBody") : t("installBody")}
          </p>
          {!showIosHint && (
            <Button size="sm" className="mt-2 gap-1.5" onClick={install}>
              <Download className="size-3.5" aria-hidden />
              {t("installAction")}
            </Button>
          )}
        </div>

        <Button variant="ghost" size="icon-sm" onClick={dismiss} aria-label={t("installDismiss")}>
          <X className="size-4" aria-hidden />
        </Button>
      </div>
    </section>
  );
}

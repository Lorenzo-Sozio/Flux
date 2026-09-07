"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import { BellRing, Loader2, MonitorSmartphone, Send, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  type PushSettings,
  removePushSubscription,
  savePushSubscription,
  sendTestPush,
  updatePushPreferences,
} from "@/actions/push";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { PUSH_TYPE_ORDER, type PushType } from "@/lib/push-types";
import { fromBase64Url } from "@/lib/web-push";

/**
 * Turning on notifications for this device, and choosing what they are about.
 *
 * ⚠️ Most of this component is about telling somebody *why* it will not work,
 * because there are five separate reasons and every one of them is invisible:
 * the browser has no push support, the deployment has no VAPID keys, permission
 * was denied once and browsers do not ask twice, the tab is not controlled by a
 * service worker, or this is an iPhone and the app is not on the home screen.
 * Silence on any of those looks identical to a switch that simply does nothing.
 */

type Support =
  | "checking"
  | "ok"
  /** No service worker or no PushManager: an old browser, or a plain http origin. */
  | "unsupported"
  /** iOS only delivers push to an installed app, and this is not one. */
  | "needs-install"
  /** Denied, and only the browser's own site settings can undo it. */
  | "denied";

/** A phrase a person can match to a device they own. Nothing more is needed. */
function describeDevice(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : null;
  const platform = /iPhone|iPad|iPod/.test(userAgent)
    ? "iOS"
    : /Android/.test(userAgent)
      ? "Android"
      : /Macintosh/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  return [browser, platform].filter(Boolean).join(" · ") || null;
}

export function PushSettingsClient({ settings }: { settings: PushSettings }) {
  const t = useTranslations("pushNotifications");
  const tc = useTranslations("common");
  const [, startTransition] = useTransition();

  const [support, setSupport] = useState<Support>("checking");
  const [thisDevice, setThisDevice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(settings.enabled);
  const [types, setTypes] = useState(settings.types);
  const [devices, setDevices] = useState(settings.devices);

  /** Reads the endpoint this browser currently holds, if any. */
  const readCurrent = useCallback(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    const existing = await registration?.pushManager.getSubscription();
    setThisDevice(existing?.endpoint ?? null);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setSupport("unsupported");
      return;
    }
    // ⚠️ On iPhone push exists only for an app added to the home screen. In a
    // Safari tab `PushManager` is present and `subscribe` throws — so checking
    // for the API is not enough, and without this the switch would look broken.
    const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isIos && !installed) {
      setSupport("needs-install");
      return;
    }
    setSupport(Notification.permission === "denied" ? "denied" : "ok");
    void readCurrent();
  }, [readCurrent]);

  /** The browser can rotate a subscription on its own; the worker tells us. */
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "PUSH_SUBSCRIPTION_CHANGED") void readCurrent();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [readCurrent]);

  async function enableHere() {
    if (!settings.publicKey) return;
    setBusy(true);
    try {
      // Must be inside the click. A permission prompt raised from anywhere else
      // is dismissed by the browser without ever being shown.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setSupport(permission === "denied" ? "denied" : "ok");
        toast.error(t("permissionRefused"));
        return;
      }

      // ⚠️ Not `serviceWorker.ready` on its own: that promise never settles when
      // nothing has registered a worker, so the button would spin for ever with
      // no error. Registration is production-only in this product, so in
      // development this is the branch that is taken.
      if (!(await navigator.serviceWorker.getRegistration())) {
        toast.error(t("noServiceWorker"));
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          // Required, and honoured: the worker shows a notification for every
          // push it receives. Promising this and not doing it gets the
          // permission revoked.
          userVisibleOnly: true,
          applicationServerKey: fromBase64Url(settings.publicKey) as BufferSource,
        }));

      const keys = subscription.toJSON().keys;
      if (!keys?.p256dh || !keys?.auth) throw new Error("The browser returned a subscription without keys.");

      const result = await savePushSubscription({
        endpoint: subscription.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: navigator.userAgent,
      });
      if ("error" in result && result.error) throw new Error(result.error);

      setThisDevice(subscription.endpoint);
      setDevices((prev) =>
        prev.some((d) => d.endpoint === subscription.endpoint)
          ? prev
          : [
              ...prev,
              {
                id: subscription.endpoint,
                endpoint: subscription.endpoint,
                userAgent: navigator.userAgent,
                createdAt: new Date(),
                lastSuccessAt: null,
              },
            ],
      );
      toast.success(t("enabledHere"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("errorOccurred"));
    } finally {
      setBusy(false);
    }
  }

  async function forget(endpoint: string) {
    setBusy(true);
    try {
      if (endpoint === thisDevice) {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        // Unsubscribe first: leaving the browser subscribed to an endpoint the
        // server has forgotten means it keeps a permission nothing will ever use.
        await subscription?.unsubscribe();
        setThisDevice(null);
      }
      await removePushSubscription(endpoint);
      setDevices((prev) => prev.filter((d) => d.endpoint !== endpoint));
      toast.success(t("deviceRemoved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc("errorOccurred"));
    } finally {
      setBusy(false);
    }
  }

  function saveMaster(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      await updatePushPreferences({ enabled: next });
    });
  }

  function saveType(type: PushType, next: boolean) {
    setTypes((prev) => ({ ...prev, [type]: next }));
    startTransition(async () => {
      await updatePushPreferences({ types: { [type]: next } });
    });
  }

  async function test() {
    setBusy(true);
    try {
      const result = await sendTestPush();
      if ("error" in result && result.error === "notConfigured") toast.error(t("notConfigured"));
      else if ("error" in result && result.error === "noDevices") toast.error(t("noDevices"));
      else if ("sent" in result && result.sent > 0) toast.success(t("testSent", { count: result.sent }));
      else if ("failures" in result) toast.error(result.failures[0] ?? t("testFailed"));
    } finally {
      setBusy(false);
    }
  }

  const notice: Record<Exclude<Support, "ok" | "checking">, { title: string; body: string }> = {
    unsupported: { title: t("unsupported.title"), body: t("unsupported.body") },
    "needs-install": { title: t("needsInstall.title"), body: t("needsInstall.body") },
    denied: { title: t("denied.title"), body: t("denied.body") },
  };

  return (
    <div className="space-y-6">
      <div className="min-w-0">
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t("subtitle")}</p>
      </div>

      {/* The deployment has no keys. Nothing a person does on this screen can
          change that, so it is said once, at the top, in plain terms. */}
      {settings.publicKey === null && (
        <Alert>
          <BellRing className="h-4 w-4" />
          <AlertTitle>{t("notConfigured")}</AlertTitle>
          <AlertDescription>{t("notConfiguredBody")}</AlertDescription>
        </Alert>
      )}

      {support !== "ok" && support !== "checking" && (
        <Alert>
          <MonitorSmartphone className="h-4 w-4" />
          <AlertTitle>{notice[support].title}</AlertTitle>
          <AlertDescription className="whitespace-pre-line">{notice[support].body}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("thisDevice")}</CardTitle>
          <CardDescription>{t("thisDeviceHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {thisDevice ? (
            <>
              <Button variant="outline" onClick={() => forget(thisDevice)} disabled={busy}>
                <Trash2 className="h-4 w-4" /> {t("disableHere")}
              </Button>
              <Button variant="secondary" onClick={test} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t("sendTest")}
              </Button>
            </>
          ) : (
            <Button onClick={enableHere} disabled={busy || support !== "ok" || settings.publicKey === null}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />} {t("enableHere")}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-base">{t("whatToSend")}</CardTitle>
            <CardDescription>{t("whatToSendHelp")}</CardDescription>
          </div>
          <Switch checked={enabled} onCheckedChange={saveMaster} aria-label={t("masterSwitch")} />
        </CardHeader>
        <CardContent className="space-y-1">
          {PUSH_TYPE_ORDER.map((type) => (
            <div key={type} className="flex items-center justify-between gap-4 py-2">
              <div className="min-w-0">
                <p className="font-medium text-sm">{t(`types.${type}.label`)}</p>
                <p className="text-muted-foreground text-xs">{t(`types.${type}.help`)}</p>
              </div>
              <Switch
                checked={types[type]}
                disabled={!enabled}
                onCheckedChange={(next) => saveType(type, next)}
                aria-label={t(`types.${type}.label`)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {devices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("devices")}</CardTitle>
            <CardDescription>{t("devicesHelp")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {devices.map((device, index) => (
              <div key={device.endpoint}>
                {index > 0 && <Separator />}
                <div className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-sm">
                      {describeDevice(device.userAgent) ?? t("unknownDevice")}
                      {device.endpoint === thisDevice && (
                        <span className="ml-2 text-muted-foreground text-xs">{t("current")}</span>
                      )}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t("addedOn", { date: new Date(device.createdAt).toLocaleDateString() })}
                      {" · "}
                      {/* A device that silently stopped working looks exactly like
                          one that does; this date is the only thing that tells
                          them apart. */}
                      {device.lastSuccessAt
                        ? t("lastSuccess", { date: new Date(device.lastSuccessAt).toLocaleDateString() })
                        : t("neverReceived")}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive"
                    onClick={() => forget(device.endpoint)}
                    disabled={busy}
                    aria-label={tc("delete")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

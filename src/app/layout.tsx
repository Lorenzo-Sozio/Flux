import type { ReactNode } from "react";

import { headers } from "next/headers";

import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";

import { SessionProvider } from "@/components/providers/session-provider";
import { ServiceWorkerRegistrar } from "@/components/pwa/service-worker-registrar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_CONFIG } from "@/config/app-config";
import { fontVars } from "@/lib/fonts/registry";
import { PREFERENCE_DEFAULTS } from "@/lib/preferences/preferences-config";
import { ThemeBootScript } from "@/scripts/theme-boot";
import { PreferencesStoreProvider } from "@/stores/preferences/preferences-provider";

import "./globals.css";

export const metadata: Metadata = {
  title: APP_CONFIG.meta.title,
  description: APP_CONFIG.meta.description,
  manifest: "/manifest.webmanifest",
  applicationName: APP_CONFIG.name,
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    // iOS has no manifest support worth relying on: this is what makes an icon
    // added from Safari open without browser chrome.
    capable: true,
    title: "Flux",
    statusBarStyle: "default",
  },
  // Phone numbers in a CRM are deliberate links; letting Safari guess at every
  // number on the page turns order totals and VAT numbers into dial prompts.
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The layout paints to the edges of the screen, including under a notch, and
  // the safe-area insets in globals.css keep content out from under it. Without
  // `cover` those insets are always zero and the bottom bar sits on the home
  // indicator.
  viewportFit: "cover",
  // Deliberately no maximumScale/userScalable: capping zoom is an accessibility
  // failure, and it is not what makes an app feel native.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#090b0c" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();
  const { theme_mode, theme_preset, content_layout, navbar_style, sidebar_variant, sidebar_collapsible, font } =
    PREFERENCE_DEFAULTS;

  // Read the per-request nonce injected by the middleware (proxy.ts).
  // The nonce is required by the Content-Security-Policy header so that
  // the ThemeBootScript inline <script> is allowed to execute.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang={locale}
      data-theme-mode={theme_mode}
      data-theme-preset={theme_preset}
      data-content-layout={content_layout}
      data-navbar-style={navbar_style}
      data-sidebar-variant={sidebar_variant}
      data-sidebar-collapsible={sidebar_collapsible}
      data-font={font}
      suppressHydrationWarning
    >
      <head>
        {/* Applies theme and layout preferences on load to avoid flicker and unnecessary server rerenders. */}
        <ThemeBootScript nonce={nonce} />
      </head>
      <body className={`${fontVars} min-h-screen antialiased`}>
        <SessionProvider>
          <NextIntlClientProvider locale={locale} messages={messages}>
            <TooltipProvider>
              <PreferencesStoreProvider
                themeMode={theme_mode}
                themePreset={theme_preset}
                contentLayout={content_layout}
                navbarStyle={navbar_style}
                font={font}
              >
                {children}
                <Toaster />
                <ServiceWorkerRegistrar />
              </PreferencesStoreProvider>
            </TooltipProvider>
          </NextIntlClientProvider>
        </SessionProvider>
      </body>
    </html>
  );
}

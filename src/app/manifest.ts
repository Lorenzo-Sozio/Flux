import type { MetadataRoute } from "next";

import { APP_CONFIG } from "@/config/app-config";

/**
 * The web app manifest, served at /manifest.webmanifest.
 *
 * What makes an installed CRM feel like an app rather than a bookmark is mostly
 * in here: the display mode that removes the browser chrome, the icons the
 * launcher uses, and the start URL it opens.
 *
 * ⚠️ `start_url` is the dashboard, not `/`. An installed icon that lands on a
 * marketing route and then bounces through a redirect shows the redirect, which
 * is the first thing a person sees every single time they open the app. Anyone
 * not signed in is sent to the login page by the proxy, which is the same
 * journey they would have had anyway.
 *
 * ⚠️ No `orientation` is declared on purpose. Locking to portrait would break a
 * tablet on a stand and the landscape reading of a pipeline board, and a CRM is
 * used in both. The layouts handle the rotation instead.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/dashboard/crm",
    name: APP_CONFIG.name,
    short_name: "Flux",
    description: APP_CONFIG.meta.description,
    start_url: "/dashboard/crm",
    scope: "/",
    display: "standalone",
    // Chrome uses this when the display mode is unavailable; a browser tab is a
    // working CRM, so it is a reasonable place to fall back to.
    display_override: ["standalone", "minimal-ui", "browser"],
    background_color: "#ffffff",
    theme_color: "#1447e6",
    lang: "it",
    dir: "ltr",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Cropped by the launcher to whatever shape the device draws. Separate
      // artwork, with the mark pulled inside the safe zone.
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Pipeline", url: "/dashboard/pipeline" },
      { name: "Ticket", url: "/dashboard/support/tickets" },
      { name: "Nuovo ordine", url: "/dashboard/sales/orders/new" },
    ],
  };
}

import type { Metadata } from "next";

import { OfflineNotice } from "./offline-notice";

export const metadata: Metadata = {
  title: "Offline",
};

/**
 * What a person sees when the network is gone.
 *
 * This is the only page the service worker precaches, and it is cached once, at
 * install. That makes it the one screen in the product whose language cannot be
 * decided on the server: the cookie that picks the locale may well have changed
 * since. So the wording lives in a small client component that reads the
 * document's own `lang`, and the page itself holds no data of any kind.
 *
 * Deliberately not an offline copy of the CRM. See the note at the top of
 * public/sw.js: a cached pipeline is a wrong number with nothing on the screen
 * to say so.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <OfflineNotice />
    </main>
  );
}

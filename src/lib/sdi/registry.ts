import { arubaProvider } from "./aruba";
import { fattureInCloudProvider } from "./fattureincloud";
import { SDI_PROVIDER_IDS, type SdiChannel, type SdiProvider, type SdiProviderId } from "./types";

/**
 * The intermediaries Flux can hand an invoice to. ⚠️ Adding one is a file implementing
 * `SdiProvider` (./types.ts) and one line here: the settings screen, the sending, the job and
 * the invoice page read this list and nothing else.
 */
const PROVIDERS: Record<SdiProviderId, SdiProvider> = {
  aruba: arubaProvider,
  fattureincloud: fattureInCloudProvider,
};

export function sdiProvider(id: SdiChannel | string | null | undefined): SdiProvider | null {
  return isSdiProviderId(id) ? PROVIDERS[id] : null;
}

export function isSdiProviderId(value: unknown): value is SdiProviderId {
  return typeof value === "string" && (SDI_PROVIDER_IDS as readonly string[]).includes(value);
}

/** The choices a workspace has, the manual one first. */
export function sdiChannels(): {
  id: SdiChannel;
  label: string | null;
  credentials: readonly string[];
  hasDemo: boolean;
}[] {
  return [
    { id: "manual", label: null, credentials: [], hasDemo: false },
    ...SDI_PROVIDER_IDS.map((id) => ({
      id,
      label: PROVIDERS[id].label,
      credentials: PROVIDERS[id].credentials,
      hasDemo: PROVIDERS[id].hasDemo,
    })),
  ];
}

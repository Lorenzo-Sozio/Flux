import { cn } from "@/lib/utils";

/**
 * The Flux mark as the app shows it — the tile from public/icons/icon.svg, the same drawing as the
 * home-screen icon and the launch screen (scripts/generate-pwa-icons.mjs, from
 * scripts/brand/flux-mark.mjs). Decorative: it always sits beside the product's name.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    // biome-ignore lint/performance/noImgElement: a static vector; next/image would only add a wrapper
    <img src="/icons/icon.svg" alt="" aria-hidden width={64} height={64} className={cn("shrink-0", className)} />
  );
}

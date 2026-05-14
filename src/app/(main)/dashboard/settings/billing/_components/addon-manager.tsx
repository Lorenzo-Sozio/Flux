"use client";

import { useState } from "react";

import { Package, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { removeAddon } from "@/actions/billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { ADDON_CONFIGS } from "@/lib/billing/plans-config";
import type { AddonType } from "@/lib/billing/plans-config";

interface Addon {
  id: string;
  addonType: string;
  quantity: number;
  status: string;
}

interface AddonManagerProps {
  addons: Addon[];
  onAddonAdded?: () => void;
}

export function AddonManager({ addons, onAddonAdded }: AddonManagerProps) {
  const t = useTranslations("settings.billing");
  const [removing, setRemoving] = useState<string | null>(null);

  const activeAddons = addons.filter((a) => a.status === "active");

  async function handleRemove(addonId: string) {
    setRemoving(addonId);
    try {
      await removeAddon(addonId);
      toast.success(t("addons.removedSuccess"));
      onAddonAdded?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("addons.removeError"));
    } finally {
      setRemoving(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          {t("addons.title")}
        </CardTitle>
        <CardDescription>{t("addons.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {activeAddons.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("addons.noActive")}</p>
        ) : (
          activeAddons.map((addon) => {
            const cfg = ADDON_CONFIGS[addon.addonType as AddonType];
            return (
              <div
                key={addon.id}
                className="flex items-center justify-between rounded-md border px-4 py-3"
              >
                <div>
                  <p className="text-sm font-medium">
                    {cfg?.displayName ?? addon.addonType}
                    {addon.quantity > 1 && (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        ×{addon.quantity}
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{cfg?.description}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  disabled={removing === addon.id}
                  onClick={() => handleRemove(addon.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            );
          })
        )}

        <Separator />

        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("addons.availableTitle")}
          </p>
          {(Object.entries(ADDON_CONFIGS) as [AddonType, (typeof ADDON_CONFIGS)[AddonType]][]).map(
            ([type, cfg]) => {
              const alreadyActive = activeAddons.some((a) => a.addonType === type);
              return (
                <div
                  key={type}
                  className="flex items-center justify-between rounded-md border px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium">{cfg.displayName}</p>
                    <p className="text-xs text-muted-foreground">{cfg.description}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t("addons.pricePerMonth", { price: (cfg.priceMonthly / 100).toFixed(0) })}
                    </p>
                  </div>
                  {alreadyActive ? (
                    <Badge variant="outline" className="text-xs">{t("addons.activeBadge")}</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toast.info(t("addons.addViaPortal"))}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      {t("addons.addButton")}
                    </Button>
                  )}
                </div>
              );
            },
          )}
        </div>
      </CardContent>
    </Card>
  );
}

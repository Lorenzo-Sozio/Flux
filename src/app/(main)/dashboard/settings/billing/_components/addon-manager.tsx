"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Package } from "lucide-react";
import { toast } from "sonner";
import { removeAddon } from "@/actions/billing";
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
  const [removing, setRemoving] = useState<string | null>(null);

  const activeAddons = addons.filter((a) => a.status === "active");

  async function handleRemove(addonId: string) {
    setRemoving(addonId);
    try {
      await removeAddon(addonId);
      toast.success("Add-on removed. Changes take effect immediately.");
      onAddonAdded?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove add-on");
    } finally {
      setRemoving(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5 text-primary" />
          Add-ons
        </CardTitle>
        <CardDescription>
          Extend your plan with additional modules and extra user seats.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {activeAddons.length === 0 ? (
          <p className="text-sm text-muted-foreground">No add-ons active on your subscription.</p>
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
            Available Add-ons
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
                      €{(cfg.priceMonthly / 100).toFixed(0)}/mo
                    </p>
                  </div>
                  {alreadyActive ? (
                    <Badge variant="outline" className="text-xs">Active</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        toast.info(
                          "To add this module, please use the Manage Billing portal above.",
                        )
                      }
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add
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

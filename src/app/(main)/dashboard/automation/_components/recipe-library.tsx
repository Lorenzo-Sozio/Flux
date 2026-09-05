"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { BookOpen, Check, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { getRecipeMatchCounts, installAutomationRecipe } from "@/actions/automation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AUTOMATION_RECIPES } from "@/lib/automation-recipes";

/**
 * The rules worth having, offered rather than described.
 *
 * The builder can write any of these and that is the problem: four decisions
 * before anything happens, on a screen most people close (audit rilievo S-04).
 *
 * The count beside each one is how many records match it **today**, which is not
 * what the audit asked for — it asked how many it would have acted on in the last
 * month, and that needs a history of changes nothing here keeps. What this can
 * answer honestly is whether the rule has anything to bite on, which is the
 * question behind the question. Recipes that fire on a change rather than a state
 * say so instead of showing a nought that means nothing.
 */
export function RecipeLibrary() {
  const t = useTranslations("automation.recipes");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number | null> | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    // Counted when the dialog opens, not on every page load: it is one query per
    // entity type, and nobody is waiting for it until they look.
    if (next && counts === null) {
      getRecipeMatchCounts()
        .then((state) => {
          setCounts(state.counts);
          // What is already here, read from the workspace rather than remembered:
          // this component's memory does not survive a reload, and a second click
          // would write a second copy of the same rule.
          setInstalled(new Set(state.installed));
        })
        .catch(() => setCounts({}));
    }
  }

  function install(id: string) {
    startTransition(async () => {
      const result = await installAutomationRecipe(id);
      if (result.success) {
        setInstalled((prev) => new Set(prev).add(id));
        toast.success(t("installed"));
        router.refresh();
      } else if (result.error === "already-installed") {
        setInstalled((prev) => new Set(prev).add(id));
        toast.info(t("alreadyAdded"));
      } else {
        toast.error(result.error ?? t("installFailed"));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <BookOpen className="h-4 w-4" /> {t("open")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("subtitle")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {AUTOMATION_RECIPES.map((recipe) => {
            const count = counts?.[recipe.id];
            const isInstalled = installed.has(recipe.id);
            return (
              <div key={recipe.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-sm leading-snug">{recipe.summary}</p>
                    <p className="text-muted-foreground text-xs leading-relaxed">{recipe.why}</p>
                  </div>
                  <Button
                    size="sm"
                    variant={isInstalled ? "ghost" : "outline"}
                    disabled={pending || isInstalled}
                    onClick={() => install(recipe.id)}
                    className="shrink-0"
                  >
                    {pending && !isInstalled ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isInstalled ? (
                      <>
                        <Check className="mr-1 h-3.5 w-3.5" /> {t("added")}
                      </>
                    ) : (
                      t("add")
                    )}
                  </Button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {recipe.rule.targetEntity}
                  </Badge>
                  {counts === null ? null : count === null || count === undefined ? (
                    <span className="text-muted-foreground text-xs">{t("onChange")}</span>
                  ) : (
                    <span className="text-muted-foreground text-xs">{t("matchesNow", { count })}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

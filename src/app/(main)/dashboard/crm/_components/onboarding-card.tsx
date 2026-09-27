"use client";

import { useTransition } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { CheckCircle2, Circle, Database, Rocket, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  confirmStagesAction,
  dismissOnboardingAction,
  loadSampleDataAction,
  removeSampleDataAction,
} from "@/actions/onboarding";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ONBOARDING_STEPS, type OnboardingState, type OnboardingStep } from "@/lib/onboarding-steps";
import { cn } from "@/lib/utils";

const HREF: Record<OnboardingStep, string> = {
  company: "/dashboard/settings/invoicing",
  team: "/dashboard/users",
  contacts: "/dashboard/contacts",
  stages: "/dashboard/settings/pipeline",
  email: "/dashboard/settings/email",
};

/**
 * Five steps to a working CRM, each ticked by the data (src/lib/onboarding.ts), and the
 * sample data that lets somebody see every screen before they have typed anything.
 */
export function OnboardingCard({ state }: { state: OnboardingState & { dependents: number } }) {
  const t = useTranslations("onboarding");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const total = ONBOARDING_STEPS.length;

  const run = (action: () => Promise<{ ok: boolean; reason?: string }>, success?: string) =>
    startTransition(async () => {
      const result = await action().catch(() => null);
      if (!result) {
        toast.error(t("failed"));
        return;
      }
      if (!result.ok) {
        toast.error(t(`sample.errors.${result.reason}` as never));
        return;
      }
      if (success) toast.success(success);
      router.refresh();
    });

  return (
    <Card className="border-primary/30">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Rocket className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("subtitle", { done: state.done, total })}</CardDescription>
        </div>
        {!state.sample && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => run(dismissOnboardingAction)}
            disabled={pending}
            aria-label={t("dismiss")}
            title={t("dismiss")}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={(state.done / total) * 100} className="h-1.5" aria-hidden />
        <ol className="space-y-1">
          {ONBOARDING_STEPS.map((step) => {
            const done = state.steps[step];
            return (
              <li key={step} className="flex items-start gap-3 rounded-md p-2 hover:bg-muted/50">
                {done ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label={t("done")} />
                ) : (
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label={t("todo")} />
                )}
                <div className="min-w-0 flex-1">
                  <p className={cn("font-medium text-sm", done && "text-muted-foreground line-through")}>
                    {t(`steps.${step}.title`)}
                  </p>
                  {!done && <p className="text-muted-foreground text-xs">{t(`steps.${step}.help`)}</p>}
                </div>
                {!done && (
                  <div className="flex shrink-0 flex-wrap justify-end gap-1">
                    {step === "stages" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => run(confirmStagesAction)}
                        disabled={pending}
                      >
                        {t("steps.stages.fine")}
                      </Button>
                    )}
                    <Button asChild variant="outline" size="sm" className="h-7 text-xs">
                      <Link href={HREF[step]}>{t("open")}</Link>
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex min-w-0 items-start gap-2 text-muted-foreground text-xs">
            <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            {state.sample ? t("sample.loaded") : t("sample.help")}
          </p>
          {state.sample ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" size="sm" className="shrink-0" disabled={pending}>
                  {t("sample.remove")}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("sample.removeTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {state.dependents > 0
                      ? t("sample.removeBodyDependents", { count: state.dependents })
                      : t("sample.removeBody")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => run(removeSampleDataAction, t("sample.removed"))}>
                    {t("sample.remove")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => run(loadSampleDataAction, t("sample.loadedToast"))}
              disabled={pending}
            >
              {t("sample.load")}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

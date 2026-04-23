"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useTranslations } from "next-intl";

import { forgotPasswordAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const formSchema = z.object({
  email: z.string().email({ message: "Please enter a valid email address." }),
});

export function ForgotPasswordForm() {
  const t = useTranslations("auth.forgotPassword");
  const [sent, setSent] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    setIsPending(true);
    try {
      await forgotPasswordAction(data.email);
      setSent(true);
    } catch {
      toast.error(t("error"));
    } finally {
      setIsPending(false);
    }
  };

  if (sent) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-center dark:border-green-800 dark:bg-green-950">
        <p className="font-medium text-green-800 dark:text-green-200">{t("checkInbox")}</p>
        <p className="mt-1 text-sm text-green-600 dark:text-green-400">{t("checkInboxDesc")}</p>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <FieldGroup className="gap-4">
        <Controller
          control={form.control}
          name="email"
          render={({ field, fieldState }) => (
            <Field className="gap-1.5" data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="forgot-email">{t("emailAddress")}</FieldLabel>
              <Input
                {...field}
                id="forgot-email"
                type="email"
                placeholder={t("emailPlaceholder")}
                autoComplete="email"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </FieldGroup>
      <Button className="w-full" type="submit" disabled={isPending}>
        {isPending ? t("sending") : t("sendResetLink")}
      </Button>
    </form>
  );
}

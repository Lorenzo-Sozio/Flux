"use client";

import { useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { resetPasswordAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const makeFormSchema = (passwordMin: string, passwordsMismatch: string) =>
  z
    .object({
      password: z.string().min(8, { message: passwordMin }),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: passwordsMismatch,
      path: ["confirmPassword"],
    });

type FormValues = z.infer<ReturnType<typeof makeFormSchema>>;

interface Props {
  email: string;
  token: string;
}

export function ResetPasswordForm({ email, token }: Props) {
  const t = useTranslations("auth.resetPasswordPage");
  const tReset = useTranslations("auth.resetPassword");
  const tRegister = useTranslations("auth.register");
  const tValidation = useTranslations("auth.validation");
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const formSchema = useMemo(
    () => makeFormSchema(tValidation("passwordMin"), tValidation("passwordsMismatch")),
    [tValidation],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = async (data: FormValues) => {
    setIsPending(true);
    try {
      const result = await resetPasswordAction({ email, token, password: data.password });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(t("success"));
      router.push("/auth/v1/login");
    } catch {
      toast.error(tRegister("error"));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <FieldGroup className="gap-4">
        <Controller
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <Field className="gap-1.5" data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="new-password">{tReset("newPassword")}</FieldLabel>
              <Input
                {...field}
                id="new-password"
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="confirmPassword"
          render={({ field, fieldState }) => (
            <Field className="gap-1.5" data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="confirm-new-password">{t("confirmNewPassword")}</FieldLabel>
              <Input
                {...field}
                id="confirm-new-password"
                type="password"
                placeholder="••••••••"
                autoComplete="new-password"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </FieldGroup>
      <Button className="w-full" type="submit" disabled={isPending}>
        {isPending ? tReset("resetting") : t("submit")}
      </Button>
      <p className="text-center text-muted-foreground text-xs">
        <Link href="/auth/v1/login" className="text-primary hover:underline">
          {t("backToLogin")}
        </Link>
      </p>
    </form>
  );
}

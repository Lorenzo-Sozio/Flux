"use client";

import { useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { registerAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type Messages = { nameMin: string; emailInvalid: string; passwordMin: string; passwordsMismatch: string };

const makeFormSchema = (m: Messages) =>
  z
    .object({
      name: z.string().min(2, { message: m.nameMin }),
      email: z.string().email({ message: m.emailInvalid }),
      password: z.string().min(8, { message: m.passwordMin }),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: m.passwordsMismatch,
      path: ["confirmPassword"],
    });

type FormValues = z.infer<ReturnType<typeof makeFormSchema>>;

export function RegisterForm() {
  const t = useTranslations("auth.register");
  const tValidation = useTranslations("auth.validation");
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const formSchema = useMemo(
    () =>
      makeFormSchema({
        nameMin: tValidation("nameMin"),
        emailInvalid: tValidation("emailInvalid"),
        passwordMin: tValidation("passwordMin"),
        passwordsMismatch: tValidation("passwordsMismatch"),
      }),
    [tValidation],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = async (data: FormValues) => {
    setIsPending(true);
    try {
      const result = await registerAction({
        name: data.name,
        email: data.email,
        password: data.password,
      });

      if (result?.error) {
        toast.error(result.error);
        return;
      }

      await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      toast.success(t("success"));
      router.push("/dashboard/crm");
      router.refresh();
    } catch {
      toast.error(t("error"));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <FieldGroup className="gap-4">
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Field className="gap-1.5" data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="register-name">{t("fullName")}</FieldLabel>
              <Input
                {...field}
                id="register-name"
                type="text"
                placeholder={tValidation("namePlaceholder")}
                autoComplete="name"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="email"
          render={({ field, fieldState }) => (
            <Field className="gap-1.5" data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="register-email">{t("email")}</FieldLabel>
              <Input
                {...field}
                id="register-email"
                type="email"
                placeholder={t("emailPlaceholder")}
                autoComplete="email"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <Field className="gap-1.5" data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="register-password">{t("password")}</FieldLabel>
              <Input
                {...field}
                id="register-password"
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
              <FieldLabel htmlFor="register-confirm-password">{t("confirmPassword")}</FieldLabel>
              <Input
                {...field}
                id="register-confirm-password"
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
        {isPending ? t("creatingAccount") : t("createAccount")}
      </Button>
    </form>
  );
}

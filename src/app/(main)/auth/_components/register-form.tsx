"use client";

import { useState } from "react";

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

const formSchema = z
  .object({
    name: z.string().min(2, { message: "Name must be at least 2 characters." }),
    email: z.string().email({ message: "Please enter a valid email address." }),
    password: z.string().min(8, { message: "Password must be at least 8 characters." }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export function RegisterForm() {
  const t = useTranslations("auth.register");
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
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
                placeholder="Mario Rossi"
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

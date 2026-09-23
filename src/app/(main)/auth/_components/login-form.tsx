"use client";

import { useEffect, useMemo, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { DEMO_FILL_EVENT, type DemoCredentials } from "./demo-credentials";

const makeFormSchema = (emailInvalid: string, passwordRequired: string) =>
  z.object({
    email: z.string().email({ message: emailInvalid }),
    password: z.string().min(1, { message: passwordRequired }),
    remember: z.boolean().optional(),
  });

type FormValues = z.infer<ReturnType<typeof makeFormSchema>>;

export function LoginForm() {
  const router = useRouter();
  const t = useTranslations("auth.login");
  const tValidation = useTranslations("auth.validation");
  const [isPending, setIsPending] = useState(false);
  const formSchema = useMemo(
    () => makeFormSchema(tValidation("emailInvalid"), tValidation("passwordRequired")),
    [tValidation],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", password: "", remember: false },
  });

  // The demo banner asks for the fields to be filled. Through the form rather than
  // the DOM, so the values are the ones that get submitted and the validation clears.
  useEffect(() => {
    const fill = (event: Event) => {
      const { email, password } = (event as CustomEvent<DemoCredentials>).detail;
      form.setValue("email", email, { shouldValidate: true });
      form.setValue("password", password, { shouldValidate: true });
    };
    window.addEventListener(DEMO_FILL_EVENT, fill);
    return () => window.removeEventListener(DEMO_FILL_EVENT, fill);
  }, [form]);

  const onSubmit = async (data: FormValues) => {
    setIsPending(true);
    try {
      const result = await signIn("credentials", {
        email: data.email,
        password: data.password,
        redirect: false,
      });

      if (result?.error) {
        toast.error(t("invalidCredentials"));
        return;
      }

      // Redirect to tenant selection; middleware handles further routing
      // (auto-redirects to /dashboard/crm if the JWT already has an activeTenantId).
      router.push("/select-tenant");
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
          name="email"
          render={({ field, fieldState }) => (
            <Field className="gap-1.5" data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="login-email">{t("email")}</FieldLabel>
              <Input
                {...field}
                id="login-email"
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
              <div className="flex items-center justify-between">
                <FieldLabel htmlFor="login-password">{t("password")}</FieldLabel>
                <Link href="/auth/v1/forgot-password" className="text-primary text-xs hover:underline" prefetch={false}>
                  {t("forgotPassword")}
                </Link>
              </div>
              <Input
                {...field}
                id="login-password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          control={form.control}
          name="remember"
          render={({ field, fieldState }) => (
            <Field orientation="horizontal" data-invalid={fieldState.invalid}>
              <Checkbox
                id="login-remember"
                name={field.name}
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(Boolean(checked))}
                aria-invalid={fieldState.invalid}
              />
              <FieldContent>
                <FieldLabel htmlFor="login-remember" className="font-normal">
                  {t("rememberMe")}
                </FieldLabel>
                {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
              </FieldContent>
            </Field>
          )}
        />
      </FieldGroup>
      <Button className="w-full" type="submit" disabled={isPending}>
        {isPending ? t("signingIn") : t("signIn")}
      </Button>
    </form>
  );
}

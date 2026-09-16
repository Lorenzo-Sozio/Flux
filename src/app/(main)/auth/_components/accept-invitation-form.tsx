"use client";

import { useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { signIn } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { acceptInvitationAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type Messages = { nameMin: string; passwordMin: string; passwordsMismatch: string };

const makeFormSchema = (m: Messages) =>
  z
    .object({
      name: z.string().min(2, { message: m.nameMin }),
      password: z.string().min(8, { message: m.passwordMin }),
      confirmPassword: z.string(),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: m.passwordsMismatch,
      path: ["confirmPassword"],
    });

type FormValues = z.infer<ReturnType<typeof makeFormSchema>>;

interface Props {
  token: string;
  email: string;
}

export function AcceptInvitationForm({ token, email }: Props) {
  const t = useTranslations("auth.acceptInvitation");
  const tValidation = useTranslations("auth.validation");
  const tRegister = useTranslations("auth.register");
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const formSchema = useMemo(
    () =>
      makeFormSchema({
        nameMin: tValidation("nameMin"),
        passwordMin: tValidation("passwordMin"),
        passwordsMismatch: tValidation("passwordsMismatch"),
      }),
    [tValidation],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", password: "", confirmPassword: "" },
  });

  const onSubmit = async (data: FormValues) => {
    setIsPending(true);
    try {
      const result = await acceptInvitationAction({ token, name: data.name, password: data.password });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      await signIn("credentials", { email, password: data.password, redirect: false });
      toast.success(t("welcome"));
      router.push("/dashboard/crm");
    } catch {
      toast.error(tRegister("error"));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <p className="text-center text-sm text-muted-foreground">
        {t.rich("creatingFor", { email, strong: (chunks) => <strong>{chunks}</strong> })}
      </p>
      <FieldGroup className="gap-4">
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <Field className="gap-1.5" data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="inv-name">{tRegister("fullName")}</FieldLabel>
              <Input
                {...field}
                id="inv-name"
                placeholder={tValidation("namePlaceholder")}
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
              <FieldLabel htmlFor="inv-password">{tRegister("password")}</FieldLabel>
              <Input
                {...field}
                id="inv-password"
                type="password"
                placeholder="••••••••"
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
              <FieldLabel htmlFor="inv-confirm">{tRegister("confirmPassword")}</FieldLabel>
              <Input
                {...field}
                id="inv-confirm"
                type="password"
                placeholder="••••••••"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </FieldGroup>
      <Button className="w-full" type="submit" disabled={isPending}>
        {isPending ? tRegister("creatingAccount") : t("acceptAndJoin")}
      </Button>
    </form>
  );
}

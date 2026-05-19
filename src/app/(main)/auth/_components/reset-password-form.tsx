"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { resetPasswordAction } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const formSchema = z
  .object({
    password: z.string().min(8, { message: "Password must be at least 8 characters." }),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

interface Props {
  email: string;
  token: string;
}

export function ResetPasswordForm({ email, token }: Props) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const onSubmit = async (data: z.infer<typeof formSchema>) => {
    setIsPending(true);
    try {
      const result = await resetPasswordAction({ email, token, password: data.password });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Password reset successfully! Please log in.");
      router.push("/auth/v1/login");
    } catch {
      toast.error("Something went wrong. Please try again.");
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
              <FieldLabel htmlFor="new-password">New Password</FieldLabel>
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
              <FieldLabel htmlFor="confirm-new-password">Confirm New Password</FieldLabel>
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
        {isPending ? "Resetting…" : "Reset Password"}
      </Button>
      <p className="text-center text-muted-foreground text-xs">
        <Link href="/auth/v1/login" className="text-primary hover:underline">
          Back to login
        </Link>
      </p>
    </form>
  );
}

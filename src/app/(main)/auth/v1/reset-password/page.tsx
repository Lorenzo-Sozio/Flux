import Link from "next/link";
import { Command } from "lucide-react";
import { ResetPasswordForm } from "../../_components/reset-password-form";

interface Props {
  searchParams: Promise<{ token?: string; email?: string }>;
}

export default async function ResetPasswordPage({ searchParams }: Props) {
  const { token, email } = await searchParams;

  if (!token || !email) {
    return (
      <div className="flex h-dvh items-center justify-center">
        <div className="text-center space-y-4">
          <h2 className="text-xl font-semibold">Invalid reset link</h2>
          <p className="text-muted-foreground">This link is invalid or has expired.</p>
          <Link href="/auth/v1/forgot-password" className="text-primary hover:underline">
            Request a new one
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh">
      <div className="hidden bg-primary lg:block lg:w-1/3">
        <div className="flex h-full flex-col items-center justify-center p-12 text-center">
          <div className="space-y-6">
            <Command className="mx-auto size-12 text-primary-foreground" />
            <div className="space-y-2">
              <h1 className="font-light text-5xl text-primary-foreground">New password</h1>
              <p className="text-primary-foreground/80 text-xl">Choose a strong password</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex w-full items-center justify-center bg-background p-8 lg:w-2/3">
        <div className="w-full max-w-md space-y-10 py-24 lg:py-32">
          <div className="space-y-4 text-center">
            <div className="font-medium tracking-tight">Set New Password</div>
            <div className="mx-auto max-w-xl text-muted-foreground">
              Resetting password for <strong>{email}</strong>
            </div>
          </div>
          <ResetPasswordForm email={email} token={token} />
        </div>
      </div>
    </div>
  );
}

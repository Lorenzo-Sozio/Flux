import Link from "next/link";
import { Command } from "lucide-react";
import { ForgotPasswordForm } from "../../_components/forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <div className="flex h-dvh">
      <div className="hidden bg-primary lg:block lg:w-1/3">
        <div className="flex h-full flex-col items-center justify-center p-12 text-center">
          <div className="space-y-6">
            <Command className="mx-auto size-12 text-primary-foreground" />
            <div className="space-y-2">
              <h1 className="font-light text-5xl text-primary-foreground">Forgot password?</h1>
              <p className="text-primary-foreground/80 text-xl">We'll send you a reset link</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex w-full items-center justify-center bg-background p-8 lg:w-2/3">
        <div className="w-full max-w-md space-y-10 py-24 lg:py-32">
          <div className="space-y-4 text-center">
            <div className="font-medium tracking-tight">Reset Password</div>
            <div className="mx-auto max-w-xl text-muted-foreground">
              Enter your email and we'll send you a link to reset your password.
            </div>
          </div>
          <div className="space-y-4">
            <ForgotPasswordForm />
            <p className="text-center text-muted-foreground text-xs">
              Remembered it?{" "}
              <Link prefetch={false} href="/auth/v1/login" className="text-primary">
                Back to login
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

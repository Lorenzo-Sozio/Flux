"use client";

import { useActionState, useState, useTransition } from "react";
import { adminLogin, requestAdminOtp } from "@/actions/admin-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "@/components/ui/input-otp";
import { AlertCircle, Mail, RotateCcw } from "lucide-react";

interface Props {
  displayName: string;
  hasPassword: boolean;
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-3 py-2.5">
      <AlertCircle className="h-4 w-4 text-red-500 dark:text-red-400 mt-0.5 shrink-0" />
      <p className="text-sm text-red-700 dark:text-red-400">{message}</p>
    </div>
  );
}

function AccountBadge({ displayName }: { displayName: string }) {
  return (
    <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
      <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1">
        Pannello di Amministrazione
      </p>
      <p className="text-xs text-blue-800 dark:text-blue-200 font-mono truncate">{displayName}</p>
    </div>
  );
}

// ─── Password flow ────────────────────────────────────────────────────────────

function PasswordForm({ displayName }: { displayName: string }) {
  const [state, action, pending] = useActionState(adminLogin, undefined);

  return (
    <Card className="border-zinc-200 dark:border-zinc-800 shadow-sm">
      <CardContent className="pt-6">
        <AccountBadge displayName={displayName} />
        <form action={action} className="space-y-4">
          <input type="hidden" name="mode" value="password" />
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              required
              autoFocus
              autoComplete="current-password"
            />
          </div>
          {state?.error && <ErrorBox message={state.error} />}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Verifica in corso…" : "Accedi al pannello"}
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-zinc-400 dark:text-zinc-600">
          Sessione valida per 8 ore dopo la verifica
        </p>
      </CardContent>
    </Card>
  );
}

// ─── OTP flow ─────────────────────────────────────────────────────────────────

function OtpForm({ displayName }: { displayName: string }) {
  const [otpSent, setOtpSent] = useState(false);
  const [otpValue, setOtpValue] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isRequesting, startRequest] = useTransition();
  const [loginState, loginAction, loginPending] = useActionState(adminLogin, undefined);

  function sendOtp() {
    setRequestError(null);
    startRequest(async () => {
      const result = await requestAdminOtp();
      if (result.success) {
        setOtpSent(true);
      } else {
        setRequestError(result.error ?? "Errore nell'invio del codice.");
      }
    });
  }

  if (!otpSent) {
    return (
      <Card className="border-zinc-200 dark:border-zinc-800 shadow-sm">
        <CardContent className="pt-6">
          <AccountBadge displayName={displayName} />

          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 p-4 mb-5">
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Questo account è autenticato tramite Google e non ha una password.
              Ricevi un <strong>codice monouso via email</strong> per completare la verifica.
            </p>
          </div>

          {requestError && <ErrorBox message={requestError} />}

          <Button
            className="w-full gap-2"
            onClick={sendOtp}
            disabled={isRequesting}
          >
            <Mail className="h-4 w-4" />
            {isRequesting ? "Invio in corso…" : "Invia codice via email"}
          </Button>
          <p className="mt-6 text-center text-xs text-zinc-400 dark:text-zinc-600">
            Il codice è valido per 10 minuti
          </p>
        </CardContent>
      </Card>
    );
  }

  // OTP input stage
  return (
    <Card className="border-zinc-200 dark:border-zinc-800 shadow-sm">
      <CardContent className="pt-6">
        <AccountBadge displayName={displayName} />

        <form action={loginAction} className="space-y-5">
          <input type="hidden" name="mode" value="otp" />
          <input type="hidden" name="otp" value={otpValue} />

          <div className="space-y-3">
            <Label>Codice OTP</Label>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Inserisci il codice a 6 cifre inviato al tuo indirizzo email.
            </p>
            <div className="flex justify-center">
              <InputOTP
                maxLength={6}
                value={otpValue}
                onChange={setOtpValue}
                autoFocus
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>
            </div>
          </div>

          {loginState?.error && <ErrorBox message={loginState.error} />}

          <Button
            type="submit"
            className="w-full"
            disabled={loginPending || otpValue.length < 6}
          >
            {loginPending ? "Verifica in corso…" : "Verifica codice"}
          </Button>
        </form>

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => { setOtpValue(""); sendOtp(); }}
            disabled={isRequesting}
            className="inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" />
            {isRequesting ? "Invio in corso…" : "Non hai ricevuto il codice? Reinvia"}
          </button>
        </div>
        <p className="mt-3 text-center text-xs text-zinc-400 dark:text-zinc-600">
          Sessione valida per 8 ore dopo la verifica
        </p>
      </CardContent>
    </Card>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export function AdminLoginForm({ displayName, hasPassword }: Props) {
  if (hasPassword) {
    return <PasswordForm displayName={displayName} />;
  }
  return <OtpForm displayName={displayName} />;
}

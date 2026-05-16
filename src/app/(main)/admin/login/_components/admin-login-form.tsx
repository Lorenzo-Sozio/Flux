"use client";

import { useActionState, useState, useTransition } from "react";

import { AlertCircle, Mail, RotateCcw } from "lucide-react";

import { adminLogin, requestAdminOtp } from "@/actions/admin-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";

type AuthMode = "password" | "otp";

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-800 dark:bg-red-950">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
      <p className="text-red-700 text-sm dark:text-red-400">{message}</p>
    </div>
  );
}

function AdminBadge() {
  return (
    <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
      <p className="font-semibold text-blue-900 text-sm dark:text-blue-100">Pannello di Amministrazione</p>
      <p className="mt-0.5 text-blue-700 text-xs dark:text-blue-300">
        Accesso riservato ad amministratori e proprietari della piattaforma.
      </p>
    </div>
  );
}

export function AdminLoginForm() {
  const [authMode, setAuthMode] = useState<AuthMode>("password");
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpValue, setOtpValue] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [isRequesting, startRequest] = useTransition();
  const [loginState, loginAction, loginPending] = useActionState(adminLogin, undefined);

  function sendOtp() {
    if (!email) return;
    setRequestError(null);
    startRequest(async () => {
      const result = await requestAdminOtp(email);
      if (result.success) {
        setOtpSent(true);
      } else {
        setRequestError(result.error ?? "Errore nell'invio del codice.");
      }
    });
  }

  function switchToOtp() {
    setAuthMode("otp");
    setOtpSent(false);
    setOtpValue("");
    setRequestError(null);
  }

  return (
    <Card className="border-zinc-200 shadow-sm dark:border-zinc-800">
      <CardContent className="pt-6">
        <AdminBadge />

        {/* ── Password flow ── */}
        {authMode === "password" && (
          <form action={loginAction} className="space-y-4">
            <input type="hidden" name="mode" value="password" />

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="admin@esempio.it"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            {loginState?.error && <ErrorBox message={loginState.error} />}

            <Button type="submit" className="w-full" disabled={loginPending}>
              {loginPending ? "Verifica in corso…" : "Accedi al pannello"}
            </Button>

            <button
              type="button"
              onClick={switchToOtp}
              className="w-full text-center text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Accedi senza password (OTP via email)
            </button>
          </form>
        )}

        {/* ── OTP flow — request step ── */}
        {authMode === "otp" && !otpSent && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-otp">Email</Label>
              <Input
                id="email-otp"
                type="email"
                placeholder="admin@esempio.it"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                autoComplete="email"
              />
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
              <p className="text-amber-800 text-sm dark:text-amber-300">
                Ricevi un <strong>codice monouso via email</strong> per accedere senza password.
              </p>
            </div>

            {requestError && <ErrorBox message={requestError} />}

            <Button className="w-full gap-2" onClick={sendOtp} disabled={isRequesting || !email}>
              <Mail className="h-4 w-4" />
              {isRequesting ? "Invio in corso…" : "Invia codice via email"}
            </Button>

            <button
              type="button"
              onClick={() => setAuthMode("password")}
              className="w-full text-center text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
            >
              Torna al login con password
            </button>
          </div>
        )}

        {/* ── OTP flow — verify step ── */}
        {authMode === "otp" && otpSent && (
          <form action={loginAction} className="space-y-5">
            <input type="hidden" name="mode" value="otp" />
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="otp" value={otpValue} />

            <div className="space-y-3">
              <Label>Codice OTP</Label>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Inserisci il codice a 6 cifre inviato a{" "}
                <span className="font-medium text-zinc-700 dark:text-zinc-300">{email}</span>.
              </p>
              <div className="flex justify-center">
                <InputOTP maxLength={6} value={otpValue} onChange={setOtpValue} autoFocus>
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

            <Button type="submit" className="w-full" disabled={loginPending || otpValue.length < 6}>
              {loginPending ? "Verifica in corso…" : "Verifica codice"}
            </Button>

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setOtpValue("");
                  sendOtp();
                }}
                disabled={isRequesting}
                className="inline-flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-600 disabled:opacity-50 dark:hover:text-zinc-300"
              >
                <RotateCcw className="h-3 w-3" />
                {isRequesting ? "Invio in corso…" : "Non hai ricevuto il codice? Reinvia"}
              </button>
            </div>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-zinc-400 dark:text-zinc-600">
          Sessione valida per 8 ore dopo la verifica
        </p>
      </CardContent>
    </Card>
  );
}

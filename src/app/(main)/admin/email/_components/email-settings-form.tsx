"use client";

import { useState, useTransition } from "react";

import { AlertCircle, CheckCircle2, Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import type { AdminEmailSettingsRow, SaveEmailSettingsInput } from "@/actions/admin-email-settings";
import { saveAdminEmailSettings, testAdminEmailSettings } from "@/actions/admin-email-settings";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";

interface Props {
  initial: AdminEmailSettingsRow | null;
}

export function EmailSettingsForm({ initial }: Props) {
  const [provider, setProvider] = useState<"resend" | "smtp">(initial?.provider ?? "resend");
  const [resendApiKey, setResendApiKey] = useState("");
  const [smtpHost, setSmtpHost] = useState(initial?.smtpHost ?? "");
  const [smtpPort, setSmtpPort] = useState(String(initial?.smtpPort ?? 587));
  const [smtpUser, setSmtpUser] = useState(initial?.smtpUser ?? "");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpSecure, setSmtpSecure] = useState(initial?.smtpSecure ?? false);
  const [fromEmail, setFromEmail] = useState(initial?.fromEmail ?? "");
  const [fromName, setFromName] = useState(initial?.fromName ?? "CRM");
  const [testTo, setTestTo] = useState("");
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  const [isSaving, startSave] = useTransition();
  const [isTesting, startTest] = useTransition();

  const handleSave = () => {
    startSave(async () => {
      try {
        const input: SaveEmailSettingsInput = {
          provider,
          resendApiKey: resendApiKey || undefined,
          smtpHost: smtpHost || undefined,
          smtpPort: Number(smtpPort) || 587,
          smtpUser: smtpUser || undefined,
          smtpPassword: smtpPassword || undefined,
          smtpSecure,
          fromEmail,
          fromName,
        };
        await saveAdminEmailSettings(input);
        toast.success("Email settings saved.");
        setResendApiKey("");
        setSmtpPassword("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed.");
      }
    });
  };

  const handleTest = () => {
    setTestResult(null);
    startTest(async () => {
      try {
        const result = await testAdminEmailSettings(testTo);
        setTestResult(result);
        if (result.success) toast.success("Test email sent successfully.");
        else toast.error(`Test failed: ${result.error}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Test failed.";
        setTestResult({ success: false, error: msg });
        toast.error(msg);
      }
    });
  };

  return (
    <div className="space-y-8">
      {/* Provider */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 font-semibold text-gray-900">Provider</h2>
        <p className="mb-4 text-xs text-gray-500">
          Seleziona il servizio da usare per l'invio di email di sistema (inviti, reset password, OTP admin).
        </p>

        <div className="w-48 space-y-1.5">
          <Label>Email provider</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as "resend" | "smtp")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="resend">Resend</SelectItem>
              <SelectItem value="smtp">SMTP</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Separator className="my-6" />

        {provider === "resend" ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="resend-key">API Key</Label>
              {initial?.hasResendApiKey && (
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Chiave configurata. Lascia vuoto per mantenerla.
                </p>
              )}
              <Input
                id="resend-key"
                type="password"
                placeholder={initial?.hasResendApiKey ? "••••••••••••••••" : "re_xxxxxxxxxxxxxxxx"}
                value={resendApiKey}
                onChange={(e) => setResendApiKey(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="smtp-host">Host SMTP</Label>
              <Input
                id="smtp-host"
                placeholder="smtp.esempio.com"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-port">Porta</Label>
              <Input
                id="smtp-port"
                type="number"
                placeholder="587"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-user">Utente</Label>
              <Input
                id="smtp-user"
                placeholder="user@esempio.com"
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="smtp-password">Password</Label>
              {initial?.hasSmtpPassword && (
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Password configurata. Lascia vuoto per mantenerla.
                </p>
              )}
              <Input
                id="smtp-password"
                type="password"
                placeholder={initial?.hasSmtpPassword ? "••••••••" : ""}
                value={smtpPassword}
                onChange={(e) => setSmtpPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="col-span-2 flex items-center gap-3">
              <Switch id="smtp-secure" checked={smtpSecure} onCheckedChange={setSmtpSecure} />
              <Label htmlFor="smtp-secure">TLS/SSL (porta 465)</Label>
            </div>
          </div>
        )}

        <Separator className="my-6" />

        {/* From */}
        <h3 className="mb-4 text-sm font-semibold text-gray-700">Mittente</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="from-name">Nome mittente</Label>
            <Input id="from-name" placeholder="CRM" value={fromName} onChange={(e) => setFromName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="from-email">Indirizzo mittente</Label>
            <Input
              id="from-email"
              type="email"
              placeholder="noreply@tuodominio.com"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isSaving ? "Salvataggio…" : "Salva configurazione"}
          </Button>
        </div>
      </div>

      {/* Test */}
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-1 font-semibold text-gray-900">Invia email di test</h2>
        <p className="mb-4 text-xs text-gray-500">
          Verifica che la configurazione salvata funzioni correttamente inviando un'email di prova.
        </p>
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="test-to">Destinatario</Label>
            <Input
              id="test-to"
              type="email"
              placeholder="test@esempio.com"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={handleTest} disabled={isTesting || !testTo}>
            {isTesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            {isTesting ? "Invio…" : "Invia test"}
          </Button>
        </div>

        {testResult && (
          <Alert
            variant={testResult.success ? "default" : "destructive"}
            className={`mt-3 ${testResult.success ? "border-green-200 bg-green-50 text-green-800" : ""}`}
          >
            {testResult.success ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            <AlertDescription>
              {testResult.success
                ? "Email di test inviata con successo. Controlla la casella di posta."
                : testResult.error}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}

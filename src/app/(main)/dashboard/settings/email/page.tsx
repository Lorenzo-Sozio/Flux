"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Send, Save, Eye, EyeOff, Server, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getEmailSettings, saveEmailSettings, testEmailConnection } from "@/actions/email-settings";

type Provider = "resend" | "smtp";

interface Settings {
  id: string | null;
  provider: Provider;
  resendApiKey: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  smtpSecure: boolean;
  fromEmail: string;
  fromName: string;
}

const DEFAULT: Settings = {
  id: null,
  provider: "resend",
  resendApiKey: "",
  smtpHost: "",
  smtpPort: 587,
  smtpUser: "",
  smtpPassword: "",
  smtpSecure: false,
  fromEmail: "noreply@yourdomain.com",
  fromName: "CRM",
};

export default function EmailSettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [testTo, setTestTo] = useState("");

  useEffect(() => {
    getEmailSettings().then((data) => {
      setSettings(data as Settings);
      setLoading(false);
    });
  }, []);

  const set = (field: keyof Settings, value: any) =>
    setSettings((s) => ({ ...s, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await saveEmailSettings(settings);
      if ("error" in result) toast.error(result.error);
      else toast.success("Email settings saved.");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testTo) { toast.error("Enter a recipient email address."); return; }
    setTesting(true);
    try {
      const result = await testEmailConnection({ ...settings, testTo });
      if ("error" in result) {
        toast.error(`Test failed: ${result.error}`);
      } else if (result.success) {
        toast.success(`Test email sent to ${testTo}. Check your inbox!`);
      } else {
        toast.error("Test failed — check your configuration.");
      }
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Email Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure how the CRM sends marketing and system emails.
        </p>
      </div>

      {/* Provider selection */}
      <div className="space-y-3">
        <Label className="text-sm font-semibold">Email Provider</Label>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => set("provider", "resend")}
            className={`flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-all ${
              settings.provider === "resend"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/40"
            }`}
          >
            <Zap className={`h-5 w-5 shrink-0 ${settings.provider === "resend" ? "text-primary" : "text-muted-foreground"}`} />
            <div>
              <p className="font-medium text-sm">Resend</p>
              <p className="text-xs text-muted-foreground">API-based, free tier 100/day</p>
            </div>
          </button>
          <button
            onClick={() => set("provider", "smtp")}
            className={`flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-all ${
              settings.provider === "smtp"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-muted-foreground/40"
            }`}
          >
            <Server className={`h-5 w-5 shrink-0 ${settings.provider === "smtp" ? "text-primary" : "text-muted-foreground"}`} />
            <div>
              <p className="font-medium text-sm">SMTP</p>
              <p className="text-xs text-muted-foreground">Any mail server or relay</p>
            </div>
          </button>
        </div>
      </div>

      <Separator />

      {/* Resend settings */}
      {settings.provider === "resend" && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-sm">Resend Configuration</h2>
            <Badge variant="secondary" className="text-xs">resend.com</Badge>
          </div>
          <div className="space-y-2">
            <Label htmlFor="resend-key">API Key</Label>
            <div className="relative">
              <Input
                id="resend-key"
                type={showApiKey ? "text" : "password"}
                value={settings.resendApiKey}
                onChange={(e) => set("resendApiKey", e.target.value)}
                placeholder="re_xxxxxxxxxxxxxxxxxxxx"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Get your API key from{" "}
              <span className="font-medium">resend.com → API Keys</span>.
              Your sender domain must be verified.
            </p>
          </div>
        </div>
      )}

      {/* SMTP settings */}
      {settings.provider === "smtp" && (
        <div className="space-y-4">
          <h2 className="font-semibold text-sm">SMTP Configuration</h2>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2 space-y-2">
              <Label htmlFor="smtp-host">Server / Host</Label>
              <Input
                id="smtp-host"
                value={settings.smtpHost}
                onChange={(e) => set("smtpHost", e.target.value)}
                placeholder="smtp.example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-port">Port</Label>
              <Input
                id="smtp-port"
                type="number"
                value={settings.smtpPort}
                onChange={(e) => set("smtpPort", parseInt(e.target.value) || 587)}
                placeholder="587"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="smtp-secure"
              type="checkbox"
              checked={settings.smtpSecure}
              onChange={(e) => set("smtpSecure", e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <Label htmlFor="smtp-secure" className="font-normal cursor-pointer">
              Use SSL/TLS (port 465)
            </Label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="smtp-user">Username</Label>
              <Input
                id="smtp-user"
                value={settings.smtpUser}
                onChange={(e) => set("smtpUser", e.target.value)}
                placeholder="user@example.com"
                autoComplete="off"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-password">Password</Label>
              <div className="relative">
                <Input
                  id="smtp-password"
                  type={showPassword ? "text" : "password"}
                  value={settings.smtpPassword}
                  onChange={(e) => set("smtpPassword", e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-md bg-muted/50 border p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Common SMTP configurations</p>
            <p><span className="font-medium">Gmail:</span> smtp.gmail.com : 587 (STARTTLS) — requires App Password</p>
            <p><span className="font-medium">Outlook/365:</span> smtp.office365.com : 587 (STARTTLS)</p>
            <p><span className="font-medium">SendGrid:</span> smtp.sendgrid.net : 587 — user: apikey, pass: SG.xxxx</p>
            <p><span className="font-medium">Amazon SES:</span> email-smtp.us-east-1.amazonaws.com : 587</p>
          </div>
        </div>
      )}

      <Separator />

      {/* Sender identity (common to both providers) */}
      <div className="space-y-4">
        <h2 className="font-semibold text-sm">Sender Identity</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="from-name">Display Name</Label>
            <Input
              id="from-name"
              value={settings.fromName}
              onChange={(e) => set("fromName", e.target.value)}
              placeholder="My Company"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="from-email">From Address</Label>
            <Input
              id="from-email"
              type="email"
              value={settings.fromEmail}
              onChange={(e) => set("fromEmail", e.target.value)}
              placeholder="noreply@yourdomain.com"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Recipients will see: <span className="font-medium text-foreground">{settings.fromName || "CRM"} &lt;{settings.fromEmail || "noreply@yourdomain.com"}&gt;</span>
        </p>
      </div>

      <Separator />

      {/* Test connection */}
      <div className="space-y-3">
        <h2 className="font-semibold text-sm">Test Connection</h2>
        <div className="flex gap-2">
          <Input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="your@email.com"
            className="max-w-xs"
          />
          <Button variant="outline" onClick={handleTest} disabled={testing} className="gap-2 shrink-0">
            {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send Test Email
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Sends a test email using the current (unsaved) configuration.
        </p>
      </div>

      {/* Save */}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={saving} className="gap-2 min-w-[120px]">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save Settings
        </Button>
      </div>
    </div>
  );
}

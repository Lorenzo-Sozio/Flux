"use client";

import { useEffect, useState } from "react";

import { Eye, EyeOff, Loader2, Mail, Save, Send, Server, Settings2, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { getEmailSettings, saveEmailSettings, testEmailConnection } from "@/actions/email-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

const COMMON_SMTP_CONFIGS = [
  {
    label: "Gmail",
    host: "smtp.gmail.com",
    port: 587,
    note: "STARTTLS — requires App Password",
  },
  {
    label: "Outlook / Microsoft 365",
    host: "smtp.office365.com",
    port: 587,
    note: "STARTTLS",
  },
  {
    label: "SendGrid",
    host: "smtp.sendgrid.net",
    port: 587,
    note: "Username: apikey, Password: SG.xxxx",
  },
  {
    label: "Amazon SES",
    host: "email-smtp.us-east-1.amazonaws.com",
    port: 587,
  },
];

export default function EmailSettingsPage() {
  const t = useTranslations("settings.email");
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

  const set = <K extends keyof Settings>(field: K, value: Settings[K]) =>
    setSettings((s) => ({ ...s, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      // The action throws when the person may not manage settings, rather than
      // returning a shape the caller has to remember to inspect.
      await saveEmailSettings(settings);
      toast.success(t("savedSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the email settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testTo) {
      toast.error(t("enterRecipient"));
      return;
    }
    setTesting(true);
    try {
      const result = await testEmailConnection({ ...settings, testTo });
      if ("error" in result) {
        toast.error(t("testFailed", { error: result.error ?? "" }));
      } else if (result.success) {
        toast.success(t("testSent", { email: testTo }));
      } else {
        toast.error(t("testFailedConfig"));
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
    <div className="w-full max-w-none space-y-6 p-6">
      {/* Page header */}
      <div>
        <h1 className="font-bold text-2xl tracking-tight">{t("title")}</h1>
        <p className="mt-1 text-muted-foreground">{t("subtitle")}</p>
      </div>

      {/* Provider selection + config */}
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-5 w-5 text-muted-foreground" />
            {t("providerLabel")}
          </CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => set("provider", "resend")}
              className={`flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-all ${
                settings.provider === "resend"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/40"
              }`}
            >
              <Zap
                className={`h-5 w-5 shrink-0 ${
                  settings.provider === "resend" ? "text-primary" : "text-muted-foreground"
                }`}
              />
              <div>
                <p className="font-medium text-sm">Resend</p>
                <p className="text-muted-foreground text-xs">{t("resendDesc")}</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => set("provider", "smtp")}
              className={`flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-all ${
                settings.provider === "smtp"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/40"
              }`}
            >
              <Server
                className={`h-5 w-5 shrink-0 ${
                  settings.provider === "smtp" ? "text-primary" : "text-muted-foreground"
                }`}
              />
              <div>
                <p className="font-medium text-sm">SMTP</p>
                <p className="text-muted-foreground text-xs">{t("smtpDesc")}</p>
              </div>
            </button>
          </div>

          {/* Dynamic provider configuration */}
          {settings.provider === "resend" && (
            <div className="w-full space-y-3 pt-2">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">{t("resendConfig")}</h3>
                <Badge variant="secondary" className="text-xs">
                  resend.com
                </Badge>
              </div>
              <div className="w-full space-y-1.5">
                <Label htmlFor="resend-key">{t("apiKey")}</Label>
                <div className="relative w-full">
                  <Input
                    id="resend-key"
                    type={showApiKey ? "text" : "password"}
                    value={settings.resendApiKey}
                    onChange={(e) => set("resendApiKey", e.target.value)}
                    placeholder="re_xxxxxxxxxxxxxxxxxxxx"
                    className="w-full pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="-translate-y-1/2 absolute top-1/2 right-3 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-muted-foreground text-xs">{t("apiKeyHint")}</p>
              </div>
            </div>
          )}

          {settings.provider === "smtp" && (
            <div className="w-full space-y-4 pt-2">
              <h3 className="font-semibold text-sm">{t("smtpConfig")}</h3>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="smtp-host">{t("serverHost")}</Label>
                  <Input
                    id="smtp-host"
                    value={settings.smtpHost}
                    onChange={(e) => set("smtpHost", e.target.value)}
                    placeholder="smtp.example.com"
                    className="w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtp-port">{t("port")}</Label>
                  <Input
                    id="smtp-port"
                    type="number"
                    value={settings.smtpPort}
                    onChange={(e) => set("smtpPort", parseInt(e.target.value, 10) || 587)}
                    placeholder="587"
                    className="w-full"
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
                <Label htmlFor="smtp-secure" className="cursor-pointer font-normal">
                  {t("useSsl")}
                </Label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="smtp-user">{t("username")}</Label>
                  <Input
                    id="smtp-user"
                    value={settings.smtpUser}
                    onChange={(e) => set("smtpUser", e.target.value)}
                    placeholder="user@example.com"
                    autoComplete="off"
                    className="w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="smtp-password">{t("password")}</Label>
                  <div className="relative w-full">
                    <Input
                      id="smtp-password"
                      type={showPassword ? "text" : "password"}
                      value={settings.smtpPassword}
                      onChange={(e) => set("smtpPassword", e.target.value)}
                      placeholder="••••••••"
                      className="w-full pr-10"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="-translate-y-1/2 absolute top-1/2 right-3 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              {/* Common configurations list */}
              <div className="w-full rounded-md border bg-muted/30 p-3">
                <p className="mb-2 font-semibold text-foreground text-xs">{t("commonConfigs")}</p>
                <ul className="space-y-1.5 text-muted-foreground text-xs">
                  {COMMON_SMTP_CONFIGS.map((cfg) => (
                    <li key={cfg.label} className="flex items-start gap-1.5">
                      <Server className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                      <span>
                        <strong className="text-foreground/90">{cfg.label}:</strong> {cfg.host} : {cfg.port}
                        {cfg.note ? ` (${cfg.note})` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sender identity */}
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Mail className="h-5 w-5 text-muted-foreground" />
            {t("senderIdentity")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="from-name">{t("displayName")}</Label>
              <Input
                id="from-name"
                value={settings.fromName}
                onChange={(e) => set("fromName", e.target.value)}
                placeholder="My Company"
                className="w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="from-email">{t("fromAddress")}</Label>
              <Input
                id="from-email"
                type="email"
                value={settings.fromEmail}
                onChange={(e) => set("fromEmail", e.target.value)}
                placeholder="noreply@yourdomain.com"
                className="w-full"
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            {t("recipientsWillSee", {
              identity: `${settings.fromName || "CRM"} <${settings.fromEmail || "noreply@yourdomain.com"}>`,
            })}
          </p>
        </CardContent>
      </Card>

      {/* Test connection */}
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Send className="h-5 w-5 text-muted-foreground" />
            {t("testConnection")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex w-full gap-2">
            <Input
              type="email"
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="your@email.com"
              className="w-full flex-1"
            />
            <Button variant="outline" onClick={handleTest} disabled={testing} className="shrink-0 gap-2">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {t("sendTest")}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">{t("testHint")}</p>
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="flex w-full justify-end">
        <Button onClick={handleSave} disabled={saving} className="min-w-[120px] gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {t("saveSettings")}
        </Button>
      </div>
    </div>
  );
}

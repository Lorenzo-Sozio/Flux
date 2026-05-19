import type { Metadata } from "next";

import { getAdminEmailSettings } from "@/actions/admin-email-settings";

import { EmailSettingsForm } from "./_components/email-settings-form";

export const metadata: Metadata = { title: "Email Settings" };

export default async function AdminEmailSettingsPage() {
  const settings = await getAdminEmailSettings();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Configurazione Email</h1>
        <p className="text-muted-foreground">
          Configura il provider di posta per l'invio di email di sistema: inviti tenant, reset password e OTP admin.
        </p>
      </div>
      <EmailSettingsForm initial={settings} />
    </div>
  );
}

import Link from "next/link";
import { Settings2, Webhook } from "lucide-react";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = (session.user as any).role;
  if (!["admin", "owner"].includes(role)) redirect("/dashboard/crm");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Configure your workspace.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/dashboard/settings/custom-fields">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader>
              <Settings2 className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>Custom Fields</CardTitle>
              <CardDescription>
                Add extra fields to contacts, leads, companies, and deals.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
        <Link href="/dashboard/settings/webhooks">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardHeader>
              <Webhook className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>Webhooks</CardTitle>
              <CardDescription>
                Send real-time HTTP notifications to external services on CRM events.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}

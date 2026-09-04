import { getAutomationEmailLogs, getAutomationRules, getRecentAutomationLogs } from "@/actions/automation";
import { hasCapability } from "@/lib/auth-guard";

import { AutomationClient } from "./_components/automation-client";
import { AutomationEmailLogs } from "./_components/automation-email-logs";
import { AutomationLogs } from "./_components/automation-logs";
import { AutomationOverview } from "./_components/automation-overview";

export const metadata = { title: "Automation Rules" };

export default async function AutomationPage() {
  // ⚠️ This asked `session.user.role`, which is the platform staff field and is
  // "user" for every customer, so a workspace viewer was shown every button and
  // every one of them was refused by the server (audit rilievo U-02, in a corner
  // the fix did not reach). The capability is the same question the action asks.
  const canEdit = await hasCapability("record:write");

  const [rules, logs, emailLogs] = await Promise.all([
    getAutomationRules(),
    getRecentAutomationLogs(50),
    getAutomationEmailLogs(100),
  ]);

  return (
    <div className="space-y-6 p-6">
      <AutomationOverview rules={rules} logs={logs} />
      <AutomationClient rules={rules} canEdit={canEdit} />
      <AutomationLogs logs={logs} rules={rules} limit={20} />
      <AutomationEmailLogs logs={emailLogs} />
    </div>
  );
}

import { getAutomationEmailLogs, getAutomationRules, getRecentAutomationLogs } from "@/actions/automation";
import { auth } from "@/auth";

import { AutomationClient } from "./_components/automation-client";
import { AutomationEmailLogs } from "./_components/automation-email-logs";
import { AutomationLogs } from "./_components/automation-logs";
import { AutomationOverview } from "./_components/automation-overview";

export const metadata = { title: "Automation Rules" };

export default async function AutomationPage() {
  const session = await auth();
  const canEdit = session?.user?.role !== "viewer";

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

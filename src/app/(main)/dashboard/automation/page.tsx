import { getAutomationRules, getRecentAutomationLogs, getAutomationEmailLogs } from "@/actions/automation"
import { auth } from "@/auth"
import { AutomationClient } from "./_components/automation-client"
import { AutomationLogs } from "./_components/automation-logs"
import { AutomationOverview } from "./_components/automation-overview"
import { AutomationEmailLogs } from "./_components/automation-email-logs"

export const metadata = { title: "Automation Rules" }

export default async function AutomationPage() {
  const session = await auth()
  const canEdit = session?.user?.role !== "viewer"

  const [rules, logs, emailLogs] = await Promise.all([
    getAutomationRules(),
    getRecentAutomationLogs(50),
    getAutomationEmailLogs(100),
  ])

  return (
    <div className="p-6 space-y-6">
      <AutomationOverview rules={rules} logs={logs} />
      <AutomationClient rules={rules} canEdit={canEdit} />
      <AutomationLogs logs={logs} rules={rules} limit={20} />
      <AutomationEmailLogs logs={emailLogs} />
    </div>
  )
}

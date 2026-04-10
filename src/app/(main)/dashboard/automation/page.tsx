import { getAutomationRules, getRecentAutomationLogs } from "@/actions/automation"
import { auth } from "@/auth"
import { AutomationClient } from "./_components/automation-client"
import { AutomationLogs } from "./_components/automation-logs"
import { AutomationOverview } from "./_components/automation-overview"

export const metadata = { title: "Automation Rules" }

export default async function AutomationPage() {
  const session = await auth()
  const canEdit = session?.user?.role !== "viewer"

  const [rules, logs] = await Promise.all([
    getAutomationRules(),
    getRecentAutomationLogs(50),
  ])

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl space-y-8">
      <AutomationOverview rules={rules} logs={logs} />
      <AutomationClient rules={rules} canEdit={canEdit} />
      <AutomationLogs logs={logs} rules={rules} limit={20} />
    </div>
  )
}

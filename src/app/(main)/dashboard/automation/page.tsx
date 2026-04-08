import { auth } from "@/auth"
import { getAutomationRules, getRecentAutomationLogs } from "@/actions/automation"
import { AutomationClient } from "./_components/automation-client"
import { AutomationOverview } from "./_components/automation-overview"
import { AutomationLogs } from "./_components/automation-logs"

export const metadata = { title: "Automation Rules" }

export default async function AutomationPage() {
  const session = await auth()
  const role    = session?.user?.role as string | undefined
  const canEdit = role !== "viewer"
  
  const rules = await getAutomationRules()
  const logs = await getRecentAutomationLogs(50)

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl space-y-8">
      {/* Overview Stats */}
      <AutomationOverview rules={rules as any} logs={logs as any} />

      {/* Rules List */}
      <AutomationClient rules={rules as any} canEdit={canEdit} />

      {/* Recent Executions */}
      <AutomationLogs
        logs={logs as any}
        rules={rules as any}
        limit={20}
      />
    </div>
  )
}

import { getMarketingCampaigns } from "@/actions/marketing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TargetIcon, SendIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CampaignModal } from "@/components/crm/campaign-modal";
import { CampaignDeleteButton } from "./_components/campaign-delete-button";

export default async function CampaignsPage() {
  let campaigns: any[] = [];

  try {
    campaigns = await getMarketingCampaigns();
  } catch (error) {
    console.error("Failed to fetch campaigns:", error);
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-500 hover:bg-green-600">Active</Badge>;
      case "completed":
        return <Badge variant="secondary">Completed</Badge>;
      default:
        return <Badge variant="outline">Draft</Badge>;
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TargetIcon className="w-6 h-6 text-primary" />
            Marketing Campaigns
          </h1>
          <p className="text-sm text-muted-foreground">Track and manage your outbound marketing efforts.</p>
        </div>
        <CampaignModal />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {campaigns && campaigns.length > 0 ? (
          campaigns.map((c: any) => (
            <Card key={c.id} className="overflow-hidden hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  {getStatusBadge(c.status)}
                  <CampaignDeleteButton campaignId={c.id} />
                </div>
                <CardTitle className="text-lg mt-2">{c.name}</CardTitle>
                <CardDescription className="line-clamp-2 min-h-[2.5rem]">
                  {c.description || "No description provided."}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 border-t bg-muted/10">
                <div className="flex justify-between items-center text-xs text-muted-foreground mb-4">
                  <span className="flex items-center gap-1">
                    <SendIcon className="w-3 h-3" />
                    0 Sent
                  </span>
                  <span>{new Date(c.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex gap-2">
                  <CampaignModal
                    campaign={{
                      id: c.id,
                      name: c.name,
                      description: c.description || undefined,
                      status: c.status,
                      templateId: c.templateId || undefined,
                    }}
                  />
                  <button className="flex-1 text-xs px-3 py-2 bg-primary/90 hover:bg-primary text-white rounded-md transition-colors">
                    Launch
                  </button>
                </div>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="col-span-full py-20 text-center border-2 border-dashed rounded-xl bg-muted/5">
            <TargetIcon className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-muted-foreground">No campaigns found. Ready to reach some leads?</p>
            <CampaignModal />
          </div>
        )}
      </div>
    </div>
  );
}

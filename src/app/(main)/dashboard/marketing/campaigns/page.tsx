import { getMarketingCampaigns } from "@/actions/marketing";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlusIcon, TargetIcon, SendIcon, MoreVerticalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default async function CampaignsPage() {
  const campaigns = await getMarketingCampaigns();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active": return <Badge className="bg-green-500 hover:bg-green-600">Active</Badge>;
      case "completed": return <Badge variant="secondary">Completed</Badge>;
      default: return <Badge variant="outline">Draft</Badge>;
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
        <Button className="gap-2">
          <PlusIcon className="w-4 h-4" /> New Campaign
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {campaigns.map((c) => (
          <Card key={c.id} className="overflow-hidden hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="flex justify-between items-start">
                {getStatusBadge(c.status)}
                <Button variant="ghost" size="icon" className="h-8 w-8 -mr-2 -mt-2 text-muted-foreground">
                  <MoreVerticalIcon className="h-4 w-4" />
                </Button>
              </div>
              <CardTitle className="text-lg mt-2">{c.name}</CardTitle>
              <CardDescription className="line-clamp-2 min-h-[2.5rem]">
                {c.description || "No description provided."}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-4 border-t bg-muted/10">
              <div className="flex justify-between items-center text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <SendIcon className="w-3 h-3" />
                  0 Sent
                </span>
                <span>Created {new Date(c.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="outline" className="flex-1 text-xs">Edit</Button>
                <Button size="sm" className="flex-1 text-xs bg-primary/90">Launch</Button>
              </div>
            </CardContent>
          </Card>
        ))}
        
        {campaigns.length === 0 && (
          <div className="col-span-full py-20 text-center border-2 border-dashed rounded-xl bg-muted/5">
             <TargetIcon className="w-12 h-12 text-muted-foreground/20 mx-auto mb-4" />
             <p className="text-muted-foreground">No campaigns found. Ready to reach some leads?</p>
             <Button variant="link" className="mt-2">Create your first campaign</Button>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { toast } from "sonner";
import { MailIcon, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { sendEmailAction } from "@/actions/email";

const emailSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Body is required"),
});

type EmailFormValues = z.infer<typeof emailSchema>;

export function SendEmailModal({ 
  entity, 
  templates,
  ownerId 
}: { 
  entity: any; 
  templates: any[];
  ownerId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const form = useForm<EmailFormValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: {
      subject: "",
      body: "",
    },
  });

  const handleTemplateSelect = (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (template) {
      // Replace placeholders
      let body = template.body;
      body = body.replace(/\{\{firstName\}\}/g, entity.firstName || "");
      body = body.replace(/\{\{lastName\}\}/g, entity.lastName || "");
      
      form.setValue("subject", template.subject);
      form.setValue("body", body);
    }
  };

  const onSubmit = async (data: EmailFormValues) => {
    try {
      setIsSending(true);
      await sendEmailAction({
        to: entity.email,
        subject: data.subject,
        body: data.body,
        leadId: entity.companyName ? entity.id : undefined, // Simple check if it's a lead
        contactId: entity.firstName && !entity.companyName ? entity.id : undefined, // Simplistic
        ownerId,
      });
      toast.success("Email sent successfully!");
      setOpen(false);
      form.reset();
    } catch (error) {
      toast.error("Failed to send email.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <MailIcon className="h-4 w-4" />
          Send Email
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Compose Email to {entity.firstName} {entity.lastName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Use Template</label>
            <Select onValueChange={handleTemplateSelect}>
              <SelectTrigger>
                <SelectValue placeholder="Select a template..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map(t => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Subject</label>
              <Input {...form.register("subject")} placeholder="Email subject" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Body</label>
              <Textarea 
                {...form.register("body")} 
                placeholder="Write your message here..." 
                className="min-h-[200px]"
              />
              <p className="text-[10px] text-muted-foreground italic">You can use {'{{firstName}}'} and {'{{lastName}}'} in templates.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Discard
              </Button>
              <Button type="submit" disabled={isSending}>
                {isSending && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
                Send Now
              </Button>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}

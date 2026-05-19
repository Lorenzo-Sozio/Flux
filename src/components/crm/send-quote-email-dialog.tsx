import React, { useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { sendQuoteEmailAction } from "@/actions/quotes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const SendQuoteEmailSchema = z.object({
  toEmail: z.string().email("Invalid email address"),
  subject: z.string().min(1, "Subject is required"),
  message: z.string().optional(),
});

interface SendQuoteEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  onSuccess?: () => void;
}

export function SendQuoteEmailDialog({ open, onOpenChange, quoteId, onSuccess }: SendQuoteEmailDialogProps) {
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<z.infer<typeof SendQuoteEmailSchema>>({
    resolver: zodResolver(SendQuoteEmailSchema),
    defaultValues: {
      toEmail: "",
      subject: "Your Quote",
      message: "Please review the attached quote and let me know if you have any questions.",
    },
  });

  async function onSubmit(data: z.infer<typeof SendQuoteEmailSchema>) {
    setIsLoading(true);
    try {
      await sendQuoteEmailAction(quoteId, data.toEmail, data.subject, data.message || "");
      toast.success("Quote sent successfully");
      onOpenChange(false);
      form.reset();
      onSuccess?.();
    } catch (error: any) {
      toast.error(error.message || "Failed to send quote");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Send Quote via Email</DialogTitle>
          <DialogDescription>Send this quote to your customer for review and approval</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="toEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Recipient Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="customer@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="subject"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Subject</FormLabel>
                  <FormControl>
                    <Input placeholder="Your Quote" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Message (Optional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Add a personal message to include in the email..." {...field} rows={4} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send Quote
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

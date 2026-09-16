import React, { useState } from "react";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { sendQuoteEmailAction } from "@/actions/quotes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** The shape only; the messages shown to the user come from `sendQuoteEmailSchema(t)`. */
const SendQuoteEmailSchema = z.object({
  toEmail: z.string().email(),
  subject: z.string().min(1),
  message: z.string().optional(),
});

function sendQuoteEmailSchema(t: (key: "invalidEmail" | "subjectRequired") => string) {
  return z.object({
    toEmail: z.string().email(t("invalidEmail")),
    subject: z.string().min(1, t("subjectRequired")),
    message: z.string().optional(),
  });
}

interface SendQuoteEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  onSuccess?: () => void;
  /**
   * What the form opens with. The follow-up draft fills these in (rilievo S-06);
   * everything about them stays editable, and nothing is sent without a click.
   */
  defaultTo?: string;
  defaultSubject?: string;
  defaultMessage?: string;
  /** Overridden when the dialog is chasing rather than sending for the first time. */
  title?: string;
  descriptionText?: string;
  submitLabel?: string;
}

export function SendQuoteEmailDialog({
  open,
  onOpenChange,
  quoteId,
  onSuccess,
  defaultTo,
  defaultSubject,
  defaultMessage,
  title,
  descriptionText,
  submitLabel,
}: SendQuoteEmailDialogProps) {
  const t = useTranslations("quotes.sendEmail");
  const [isLoading, setIsLoading] = useState(false);

  const form = useForm<z.infer<typeof SendQuoteEmailSchema>>({
    resolver: zodResolver(sendQuoteEmailSchema(t)),
    defaultValues: {
      toEmail: defaultTo ?? "",
      subject: defaultSubject ?? t("defaultSubject"),
      message: defaultMessage ?? t("defaultMessage"),
    },
  });

  // The dialog stays mounted between openings, so the draft has to be put back
  // each time it opens. Without this, a follow-up opened after a first send shows
  // the previous message — the one already sent to that customer.
  React.useEffect(() => {
    if (!open) return;
    form.reset({
      toEmail: defaultTo ?? "",
      subject: defaultSubject ?? t("defaultSubject"),
      message: defaultMessage ?? t("defaultMessage"),
    });
  }, [open, defaultTo, defaultSubject, defaultMessage, form, t]);

  async function onSubmit(data: z.infer<typeof SendQuoteEmailSchema>) {
    setIsLoading(true);
    try {
      await sendQuoteEmailAction(quoteId, data.toEmail, data.subject, data.message || "");
      toast.success(t("sent"));
      onOpenChange(false);
      form.reset();
      onSuccess?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("sendFailed"));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{title ?? t("title")}</DialogTitle>
          <DialogDescription>{descriptionText ?? t("description")}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="toEmail"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("recipient")}</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder={t("recipientPlaceholder")} {...field} />
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
                  <FormLabel>{t("subject")}</FormLabel>
                  <FormControl>
                    <Input placeholder={t("subjectPlaceholder")} {...field} />
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
                  <FormLabel>{t("message")}</FormLabel>
                  <FormControl>
                    <Textarea placeholder={t("messagePlaceholder")} {...field} rows={4} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {submitLabel ?? t("submit")}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

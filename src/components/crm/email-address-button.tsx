"use client";

import type { ComponentProps } from "react";

import { SendEmailModal } from "@/components/crm/send-email-modal";

type ModalProps = ComponentProps<typeof SendEmailModal>;

/**
 * An email address shown on a page, which opens the CRM's email dialog rather than the
 * computer's mail app: what is written from here uses the templates and the copilot, goes out
 * from the person's mailbox or the workspace, and lands on the record's timeline. A `mailto:`
 * link did none of that, and the email was never seen again by anybody else.
 *
 * Whoever may not write gets the plain link: reading an address is not sending from the CRM.
 */
export function EmailAddressButton({
  email,
  entity,
  entityType,
  dealId,
  ownerId,
  templates,
  ai,
  fields,
  canSend = true,
  className,
  label,
  title,
  children,
}: {
  email: string;
  entity: ModalProps["entity"];
  entityType?: ModalProps["entityType"];
  dealId?: string;
  ownerId?: string;
  templates?: ModalProps["templates"];
  ai?: ModalProps["ai"];
  /** The fields of the record it is written from: see `SendEmailModal`. */
  fields?: ModalProps["fields"];
  canSend?: boolean;
  className?: string;
  /** For an icon-only trigger. */
  label?: string;
  title?: string;
  children?: React.ReactNode;
}) {
  if (!canSend) {
    return (
      <a href={`mailto:${email}`} className={className} aria-label={label} title={title}>
        {children ?? email}
      </a>
    );
  }
  return (
    <SendEmailModal
      entity={{ ...entity, email }}
      entityType={entityType}
      dealId={dealId}
      ownerId={ownerId}
      templates={templates}
      ai={ai}
      fields={fields}
      trigger={
        <button
          type="button"
          className={className ? `text-left ${className}` : "text-left"}
          aria-label={label}
          title={title}
        >
          {children ?? email}
        </button>
      }
    />
  );
}

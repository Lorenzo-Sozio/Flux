"use client";

import Link from "next/link";

import { onAppointmentLinkClick } from "./calendar-selection";

/**
 * A link to an appointment that opens the detail panel in place. For the
 * server-rendered rows (the list view, the month on a phone); the draggable
 * blocks and pills do the same thing themselves.
 */
export function AppointmentLink({
  href,
  className,
  children,
  "aria-label": ariaLabel,
  title,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
  title?: string;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      data-appointment-link=""
      aria-label={ariaLabel}
      title={title}
      className={className}
      onClick={(e) => onAppointmentLinkClick(e, href)}
    >
      {children}
    </Link>
  );
}

import Link from "next/link";

import { and, eq, gt } from "drizzle-orm";
import { Command } from "lucide-react";

import { platformDb } from "@/db";
import { userInvitations } from "@/db/schema";

import { AcceptInvitationForm } from "../../_components/accept-invitation-form";

interface Props {
  searchParams: Promise<{ token?: string }>;
}

export default async function AcceptInvitationPage({ searchParams }: Props) {
  const { token } = await searchParams;

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!token || !UUID_RE.test(token)) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="text-center space-y-4">
          <h2 className="text-xl font-semibold">Invalid invitation</h2>
          <p className="text-muted-foreground">This invitation link is invalid.</p>
        </div>
      </div>
    );
  }

  const [invitation] = await platformDb
    .select()
    .from(userInvitations)
    .where(and(eq(userInvitations.token, token), gt(userInvitations.expiresAt, new Date())));

  if (!invitation) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="text-center space-y-4">
          <h2 className="text-xl font-semibold">Invitation expired or invalid</h2>
          <p className="text-muted-foreground">Please ask your admin to send a new invitation.</p>
          <Link href="/auth/v1/login" className="text-primary hover:underline">
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  if (invitation.acceptedAt) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="text-center space-y-4">
          <h2 className="text-xl font-semibold">Already accepted</h2>
          <p className="text-muted-foreground">This invitation has already been used.</p>
          <Link href="/auth/v1/login" className="text-primary hover:underline">
            Go to login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh">
      <div className="hidden bg-primary lg:block lg:w-1/3">
        <div className="flex h-full flex-col items-center justify-center p-12 text-center">
          <div className="space-y-6">
            <Command className="mx-auto size-12 text-primary-foreground" />
            <div className="space-y-2">
              <h1 className="font-light text-5xl text-primary-foreground">You're invited!</h1>
              <p className="text-primary-foreground/80 text-xl">Join the team</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex w-full items-center justify-center overflow-y-auto bg-background p-4 sm:p-8 lg:w-2/3">
        <div className="w-full max-w-md space-y-8 py-8 sm:space-y-10 sm:py-24 lg:py-32">
          <div className="space-y-4 text-center">
            <div className="font-medium tracking-tight">Accept Invitation</div>
            <div className="mx-auto max-w-xl text-muted-foreground">
              Set up your account to get started. You've been assigned the role of{" "}
              <strong className="capitalize">{invitation.role}</strong>.
            </div>
          </div>
          <AcceptInvitationForm token={token} email={invitation.email} />
        </div>
      </div>
    </div>
  );
}

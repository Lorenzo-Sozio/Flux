import { getOwnMailbox } from "@/actions/mailbox";
import { getHomeDashboardSetting } from "@/actions/preferences";
import { getOwnArchiveAddress, getOwnBookingLink, getOwnProfile, getOwnSignature } from "@/actions/profile";
import { hasCapability } from "@/lib/auth-guard";
import { requirePageCapability } from "@/lib/page-guard";

import { ArchiveAddressCard } from "./_components/archive-address-card";
import { BookingLinkCard } from "./_components/booking-link-card";
import { HomeDashboardCard } from "./_components/home-dashboard-card";
import { MailboxCard } from "./_components/mailbox-card";
import { ProfileClient } from "./_components/profile-client";
import { SignatureCard } from "./_components/signature-card";

export default async function ProfilePage() {
  await requirePageCapability("record:read", "/dashboard/profile");
  const [profile, archive, booking, mailbox, homeDashboard, signature, canEditBrand] = await Promise.all([
    getOwnProfile(),
    // Never the reason the profile page fails: without them, the cards say they are unavailable.
    getOwnArchiveAddress().catch((err) => {
      console.error("[profile] archive address unavailable:", err);
      return { status: "unavailable", reason: "notConfigured" } as const;
    }),
    getOwnBookingLink().catch((err) => {
      console.error("[profile] booking link unavailable:", err);
      return { status: "unavailable", reason: "notConfigured" } as const;
    }),
    getOwnMailbox().catch((err) => {
      console.error("[profile] mailbox unavailable:", err);
      return null;
    }),
    getHomeDashboardSetting().catch((err) => {
      console.error("[profile] home dashboard setting unavailable:", err);
      return null;
    }),
    getOwnSignature().catch((err) => {
      console.error("[profile] email signature unavailable:", err);
      return null;
    }),
    hasCapability("settings:manage").catch(() => false),
  ]);
  return (
    <ProfileClient
      {...profile}
      archive={
        <>
          {homeDashboard && (
            <HomeDashboardCard
              saved={homeDashboard.saved}
              available={homeDashboard.available}
              fallback={homeDashboard.fallback}
            />
          )}
          {signature && <SignatureCard initial={signature} canEditBrand={canEditBrand} />}
          {mailbox && <MailboxCard initial={mailbox} />}
          <BookingLinkCard initial={booking} />
          <ArchiveAddressCard initial={archive} />
        </>
      }
    />
  );
}

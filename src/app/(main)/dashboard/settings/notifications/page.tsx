import { getDigestPreference } from "@/actions/digest";
import { getPushSettings } from "@/actions/push";
import { requirePageCapability } from "@/lib/page-guard";

import { DigestSetting } from "./_components/digest-setting";
import { PushSettingsClient } from "./_components/push-settings-client";

/**
 * Personal notification settings.
 *
 * ⚠️ Gated on `record:read`, which every workspace role has, and deliberately
 * not on `settings:manage`. This page configures nothing about the workspace —
 * it configures one person's own phone. A `viewer` is as entitled to be told
 * that a task was assigned to them as an owner is, and the actions behind it
 * take no user id from the caller, so the session is the boundary.
 */
export default async function NotificationSettingsPage() {
  await requirePageCapability("record:read", "/dashboard/settings/notifications");

  const [settings, digest] = await Promise.all([getPushSettings(), getDigestPreference()]);

  return (
    <div className="space-y-6">
      <PushSettingsClient settings={settings} />
      <DigestSetting initial={digest} />
    </div>
  );
}

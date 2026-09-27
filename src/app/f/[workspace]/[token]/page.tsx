import { headers } from "next/headers";
import { notFound } from "next/navigation";

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { loadWebFormPage } from "@/lib/web-forms-public";

import { WebFormClient } from "./web-form-client";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ workspace: string; token: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { workspace, token } = await params;
  const page = await loadWebFormPage(workspace, token).catch(() => null);
  const t = await getTranslations("webForm");
  return {
    title: page ? t(`${page.kind}.title`, { name: page.workspaceName }) : t("closed"),
    robots: { index: false },
  };
}

/**
 * A workspace's public form, hosted — or framed on the customer's own site (the proxy lets
 * `/f/` be embedded). Turnstile is drawn when the deployment has a key, with the request's
 * nonce: the policy allows no script without one.
 */
export default async function WebFormPage({ params }: Props) {
  const { workspace, token } = await params;
  const page = await loadWebFormPage(workspace, token).catch(() => null);
  if (!page) notFound();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <>
      {/* ⚠️ No `integrity`: Cloudflare serves api.js unversioned and updates it in place, so a
          pinned hash breaks the widget at their next release. The nonce is what admits it. */}
      {page.siteKey && <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer nonce={nonce} />}
      <WebFormClient workspace={workspace} token={token} page={page} />
    </>
  );
}

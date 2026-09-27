import { getStorage } from "@/lib/storage";
import type { getDb } from "@/lib/tenant-context";
import { type LogoType, readLogoRef } from "@/lib/workspace-preferences";

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * The workspace's logo, as bytes a PDF can embed, or null.
 *
 * ⚠️ Never throws: a document without its logo is still the document. A storage that is
 * not configured, an object that has gone, or a row pointing at nothing all print the
 * quote exactly as it printed before there was a logo.
 */
export async function loadWorkspaceLogo(db: Db): Promise<{ bytes: Uint8Array; contentType: LogoType } | null> {
  try {
    const ref = await readLogoRef(db);
    if (!ref) return null;
    const bytes = await (await getStorage()).get(ref.key);
    return bytes ? { bytes, contentType: ref.contentType } : null;
  } catch (err) {
    console.error("[workspace-logo] could not load the logo:", err);
    return null;
  }
}

import { NextResponse } from "next/server";
import { getTenantBySubdomain } from "@/lib/get-tenant";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  if (process.env.ENABLE_TENANT_OVERRIDE !== "true") {
    return new Response("Not found", { status: 404 });
  }

  const { slug } = await params;

  // Validate that the tenant exists before setting the cookie.
  const tenant = await getTenantBySubdomain(slug);
  if (!tenant) {
    return new Response(`Tenant "${slug}" not found`, { status: 404 });
  }

  const res = NextResponse.redirect(new URL("/dashboard", _req.url));
  res.cookies.set("__tenant_override", slug, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // 8-hour session for testing
    maxAge: 60 * 60 * 8,
    path: "/",
  });
  return res;
}

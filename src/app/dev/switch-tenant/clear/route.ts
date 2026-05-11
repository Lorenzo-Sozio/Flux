import { NextResponse } from "next/server";

export async function GET(req: Request) {
  if (process.env.ENABLE_TENANT_OVERRIDE !== "true") {
    return new Response("Not found", { status: 404 });
  }

  const res = NextResponse.redirect(new URL("/", req.url));
  res.cookies.delete("__tenant_override");
  return res;
}

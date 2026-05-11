import type { NextAuthConfig } from "next-auth"
import { extractSubdomainFromHost } from "./lib/subdomain"

export const authConfig = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const host = request.headers.get("host") ?? request.nextUrl.host
      const subdomain = extractSubdomainFromHost(host)

      // Tenant subdomain requests are handled by the proxy — let them through.
      if (subdomain) return true

      const isLoggedIn = !!auth?.user
      const { nextUrl } = request
      const isOnLogin = nextUrl.pathname.startsWith("/login") || nextUrl.pathname.startsWith("/auth/v1/login")

      if (isOnLogin) {
        // Already logged in on main domain → go to admin panel.
        if (isLoggedIn) return Response.redirect(new URL("/admin/tenants", nextUrl))
        return true
      }

      if (!isLoggedIn) return false
      return true
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.role = (user as any).role
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        (session.user as any).role = token.role as string
      }
      return session
    },
  },
} satisfies NextAuthConfig
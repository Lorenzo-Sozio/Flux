import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/auth/v1/login",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const { nextUrl } = request;

      // Admin routes use their own independent auth system (admin_sess cookie).
      // NextAuth must not intercept or redirect these paths.
      if (nextUrl.pathname.startsWith("/admin")) return true;

      const isOnLogin =
        nextUrl.pathname.startsWith("/auth/v1/login") ||
        nextUrl.pathname.startsWith("/auth/v2/login") ||
        nextUrl.pathname.startsWith("/login");

      if (isOnLogin) {
        if (isLoggedIn) return Response.redirect(new URL("/select-tenant", nextUrl));
        return true;
      }

      if (!isLoggedIn) return false;
      return true;
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
        session.user.activeTenantId = token.activeTenantId ?? null;
        session.user.tenantRole = token.tenantRole ?? null;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

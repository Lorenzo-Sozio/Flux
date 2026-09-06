import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  /**
   * Auth.js refuses any request whose Host is not declared trusted, and from that
   * point every /api/auth/* route answers `UntrustedHost: Host must be trusted`.
   *
   * The default comes from `setEnvDefaults` in @auth/core, which trusts the host when
   * one of AUTH_URL, AUTH_TRUST_HOST, VERCEL or CF_PAGES is set — or when NODE_ENV is
   * not "production". On Vercel the VERCEL variable is always present, and locally
   * NODE_ENV is "development": which is why this never showed up before. On Cloudflare
   * *Workers* none of the four is set (CF_PAGES belongs to Pages, not Workers), so in
   * production the default becomes `false`.
   *
   * Trusting the Host header here is safe because the app answers on more than one
   * hostname, so a fixed AUTH_URL would break every name but one. And an arbitrary host
   * never reaches us: the Worker only receives requests for the routes bound to it —
   * its workers.dev subdomain and the custom domains configured — so it is Cloudflare
   * that constrains the set of possible Hosts, which is the same guarantee the `VERCEL`
   * shortcut rests on.
   */
  trustHost: true,
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

      const isOnLogin = nextUrl.pathname.startsWith("/auth/v1/login") || nextUrl.pathname.startsWith("/login");

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
        session.user.activeTenantId = (token.activeTenantId as string) ?? null;
        session.user.tenantRole = (token.tenantRole as string) ?? null;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

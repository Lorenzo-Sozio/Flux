import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  /**
   * Auth.js rifiuta le richieste il cui Host non è dichiarato fidato, e a quel punto
   * ogni rotta /api/auth/* risponde `UntrustedHost: Host must be trusted`.
   *
   * Il default lo decide `setEnvDefaults` in @auth/core, che considera fidato l'host
   * se è impostata una fra AUTH_URL, AUTH_TRUST_HOST, VERCEL, CF_PAGES — oppure se
   * NODE_ENV non è "production". Su Vercel la variabile VERCEL c'è sempre, e in
   * locale NODE_ENV è "development": ecco perché il problema non si vedeva prima.
   * Su Cloudflare *Workers* non c'è nessuna delle quattro (CF_PAGES è di Pages, non
   * di Workers), quindi in produzione il default diventa `false`.
   *
   * Fidarsi dell'header Host qui è sicuro perché l'app è multi-tenant a sottodomini:
   * l'host cambia per tenant, quindi un AUTH_URL fisso li romperebbe tutti tranne uno.
   * E l'host arbitrario non arriva: il Worker riceve solo le richieste per le route a
   * lui associate (il sottodominio workers.dev e i domini custom configurati), quindi
   * è Cloudflare a vincolare l'insieme degli Host possibili — la stessa garanzia su
   * cui si basa la scorciatoia `VERCEL`.
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

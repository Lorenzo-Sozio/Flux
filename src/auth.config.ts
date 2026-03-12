import type { NextAuthConfig } from "next-auth"

export const authConfig = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isOnLogin = nextUrl.pathname.startsWith("/login")

      if (isOnLogin) {
        if (isLoggedIn) return Response.redirect(new URL("/", nextUrl))
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
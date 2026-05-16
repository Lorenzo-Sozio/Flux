import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import type { DefaultSession } from "next-auth";
import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";

import { authConfig } from "./auth.config";
import { platformDb } from "./db";
import { accounts, sessions, tenantMembers, users, verificationTokens } from "./db/schema";

type Role = "admin" | "editor" | "viewer" | "owner";

declare module "next-auth" {
  interface User {
    role?: Role;
    activeTenantId?: string | null;
    tenantRole?: string | null;
  }
  interface Session {
    user: User &
      DefaultSession["user"] & {
        activeTenantId?: string | null;
        tenantRole?: string | null;
      };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    role?: string;
    activeTenantId?: string | null;
    tenantRole?: string | null;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(platformDb, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const [user] = await platformDb
          .select()
          .from(users)
          .where(eq(users.email, credentials.email as string));

        if (!user || !user.password) return null;

        const isValid = await bcrypt.compare(credentials.password as string, user.password);
        if (!isValid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role as Role,
        } as const;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      // Initial login: load tenant memberships and auto-select if single tenant
      if (user) {
        token.id = user.id;
        token.role = (user as any).role;

        const memberships = await platformDb.query.tenantMembers.findMany({
          where: eq(tenantMembers.userId, user.id!),
        });

        if (memberships.length === 1) {
          token.activeTenantId = memberships[0].tenantId;
          token.tenantRole = memberships[0].role;
        } else {
          token.activeTenantId = null;
          token.tenantRole = null;
        }
      }

      // Tenant switch triggered from client via session.update({ activeTenantId })
      if (trigger === "update" && session?.activeTenantId) {
        const membership = await platformDb.query.tenantMembers.findFirst({
          where: and(eq(tenantMembers.userId, token.id as string), eq(tenantMembers.tenantId, session.activeTenantId)),
        });
        if (membership) {
          token.activeTenantId = membership.tenantId;
          token.tenantRole = membership.role;
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        (session.user as any).role = token.role;
        session.user.activeTenantId = (token.activeTenantId as string) ?? null;
        session.user.tenantRole = (token.tenantRole as string) ?? null;
      }
      return session;
    },
  },
});

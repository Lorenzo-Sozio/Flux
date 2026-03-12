import NextAuth from "next-auth"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { db } from "./db"
import { accounts, sessions, users, verificationTokens } from "./db/schema"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider from "next-auth/providers/google"
import { eq } from "drizzle-orm"
import bcrypt from "bcryptjs"
import { authConfig } from "./auth.config"

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
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
        if (!credentials?.email || !credentials?.password) return null
        
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, credentials.email as string))
        
        if (!user || !user.password) return null
        
        const isValid = await bcrypt.compare(credentials.password as string, user.password)
        if (!isValid) return null
        
        return { 
          id: user.id, 
          name: user.name, 
          email: user.email, 
          role: user.role 
        }
      },
    }),
  ],
})
import { type Role, getServices } from "@/lib/services";
import { users, verifyPassword } from "@app/db";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";

const credentialsSchema = z.object({ email: z.email(), password: z.string().min(1) });

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt", maxAge: 60 * 60 * 8 },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { db } = getServices();
        const [user] = await db.select().from(users).where(eq(users.email, parsed.data.email.toLowerCase()));
        // Same work and same answer for "no such user" and "wrong password".
        if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) return null;
        return { id: String(user.id), email: user.email, role: user.role, customerId: user.customerId };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = Number(user.id);
        token.role = user.role as Role;
        token.customerId = user.customerId ?? null;
      }
      return token;
    },
    session({ session, token }) {
      session.user.userId = token.userId;
      session.user.role = token.role;
      session.user.customerId = token.customerId;
      return session;
    },
  },
});

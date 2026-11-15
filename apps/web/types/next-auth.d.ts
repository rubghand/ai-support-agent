import type { DefaultSession } from "next-auth";

type Role = "customer" | "admin";

declare module "next-auth" {
  interface User {
    role?: Role;
    customerId?: string | null;
  }
  interface Session {
    user: {
      userId: number;
      role: Role;
      customerId: string | null;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId: number;
    role: Role;
    customerId: string | null;
  }
}

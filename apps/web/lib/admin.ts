import { redirect } from "next/navigation";
import { connection } from "next/server";
import { auth } from "@/auth";

/** Admin pages render per request (auth() can't run during prerender) and re-check the role themselves. */
export async function requireAdmin() {
  await connection();
  const session = await auth();
  if (session?.user.role !== "admin") redirect("/");
  return session.user;
}

export const formatTime = (date: Date | null) =>
  date ? `${date.toISOString().slice(0, 16).replace("T", " ")} UTC` : "—";

export const formatUsd = (value: number) => `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;

export const formatMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

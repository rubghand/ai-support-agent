import { auth, signOut } from "@/auth";
import { ChatWidget } from "@/components/chat/chat-widget";
import { Suspense } from "react";

async function SessionBar() {
  const session = await auth();
  if (!session?.user) return null;
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}
      className="flex items-center gap-3 text-sm text-zinc-600"
    >
      <span>
        {session.user.email} ({session.user.role})
      </span>
      <button type="submit" className="underline">
        Sign out
      </button>
    </form>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">Ledgerly Support</h1>
      <Suspense>
        <SessionBar />
      </Suspense>
      <ChatWidget />
    </main>
  );
}

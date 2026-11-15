import { ChatWidget } from "@/components/chat/chat-widget";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">Ledgerly Support</h1>
      <ChatWidget />
    </main>
  );
}

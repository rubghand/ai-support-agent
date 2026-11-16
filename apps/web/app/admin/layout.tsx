import Link from "next/link";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/conversations", label: "Conversations" },
  { href: "/admin/approvals", label: "Approvals" },
] as const;

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <>
      <nav className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-5 px-8 py-3 text-sm">
          <span className="font-semibold">Ledgerly admin</span>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="text-zinc-600 hover:text-zinc-900">
              {l.label}
            </Link>
          ))}
          <Link href="/" className="ml-auto text-zinc-500 underline">
            Back to chat
          </Link>
        </div>
      </nav>
      {children}
    </>
  );
}

import { signIn } from "@/auth";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";

async function login(formData: FormData) {
  "use server";
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/",
    });
  } catch (error) {
    if (error instanceof AuthError) redirect("/login?error=1");
    throw error;
  }
}

async function ErrorMessage({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { error } = await searchParams;
  return error ? <p className="text-sm text-red-700">Invalid email or password.</p> : null;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex max-w-sm flex-1 flex-col justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <form action={login} className="flex flex-col gap-3">
        <input
          name="email"
          type="email"
          required
          autoComplete="username"
          placeholder="Email"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="Password"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        />
        <Suspense>
          <ErrorMessage searchParams={searchParams} />
        </Suspense>
        <button type="submit" className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white">
          Sign in
        </button>
      </form>
      <p className="text-xs text-zinc-500">Demo: maya@brightpixelstudio.example / demo1234</p>
    </main>
  );
}

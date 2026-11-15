import { auth } from "@/auth";
import { NextResponse } from "next/server";

/**
 * Coarse gate: send signed-out visitors to /login and keep non-admins out of /admin.
 * It is a convenience, not the security boundary: API routes re-check the session themselves.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if (pathname.startsWith("/admin") && req.auth.user.role !== "admin") {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }
  return NextResponse.next();
});

export const config = {
  // API routes answer 401 themselves; /login and /api/auth must stay public.
  matcher: ["/((?!api|login|_next/static|_next/image|favicon.ico).*)"],
};

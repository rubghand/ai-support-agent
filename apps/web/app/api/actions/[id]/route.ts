import { getActionForUser } from "@app/core";
import { auth } from "@/auth";
import { getServices } from "@/lib/services";

/** Status of one of the caller's approval requests; the chat widget polls it while a request is pending. */
export async function GET(_request: Request, ctx: RouteContext<"/api/actions/[id]">) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const id = Number((await ctx.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Not found" }, { status: 404 });
  // Someone else's action is indistinguishable from a missing one.
  const action = await getActionForUser(getServices().db, session.user.userId, id);
  if (!action) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(action, { headers: { "Cache-Control": "no-store" } });
}

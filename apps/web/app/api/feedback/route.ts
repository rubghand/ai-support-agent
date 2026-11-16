import { submitFeedback } from "@app/core";
import { z } from "zod";
import { auth } from "@/auth";
import { getServices } from "@/lib/services";

const bodySchema = z.object({
  messageId: z.number().int().positive(),
  rating: z.enum(["up", "down"]),
});

/** Thumbs up/down on an assistant message the caller received. */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Not signed in" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400 });
  const result = await submitFeedback(
    getServices().db,
    session.user.userId,
    parsed.data.messageId,
    parsed.data.rating,
  );
  if (!result.ok) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}

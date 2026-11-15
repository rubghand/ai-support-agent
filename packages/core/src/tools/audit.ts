import { type Db, auditLog } from "@app/db";
import type { Identity } from "./types";

type Writer = Pick<Db, "insert">;

export async function writeAudit(
  db: Writer,
  actor: Pick<Identity, "userId">,
  entry: { action: string; targetType: string; targetId: string; details?: Record<string, unknown> },
) {
  await db.insert(auditLog).values({ actorUserId: actor.userId, details: {}, ...entry });
}

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import pg from "pg";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>["db"];

export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
  const db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../migrations") });
}

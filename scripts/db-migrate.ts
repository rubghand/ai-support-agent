import { loadConfig } from "@app/core";
import { createDb, runMigrations } from "@app/db";

const { db, close } = createDb(loadConfig().DATABASE_URL);
await runMigrations(db);
await close();
console.log("migrations applied");

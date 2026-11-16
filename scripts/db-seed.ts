import { loadConfig } from "@app/core";
import { createDb, seedDatabase, users } from "@app/db";

// `--if-empty` keeps existing data (used by the Docker setup service, which runs on every `docker compose up`).
const ifEmpty = process.argv.includes("--if-empty");

const { db, close } = createDb(loadConfig().DATABASE_URL);
if (ifEmpty && (await db.$count(users)) > 0) {
  console.log("database already seeded, skipping (run without --if-empty to reset)");
} else {
  console.table(await seedDatabase(db));
}
await close();

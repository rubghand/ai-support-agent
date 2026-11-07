import { loadConfig } from "@app/core";
import { createDb, seedDatabase } from "@app/db";

const { db, close } = createDb(loadConfig().DATABASE_URL);
const counts = await seedDatabase(db);
await close();
console.table(counts);

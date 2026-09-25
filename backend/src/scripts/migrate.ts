import "../loadEnv.js";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { parseDatabaseConfig } from "../config.js";
import { createDatabase } from "../db/index.js";

type Environment = Readonly<Record<string, string | undefined>>;

export const migrationsDirectory = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function runMigrations(environment: Environment): Promise<void> {
  const database = createDatabase(parseDatabaseConfig(environment));
  try {
    await migrate(database.database, { migrationsFolder: migrationsDirectory });
  } finally {
    await database.close();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href) {
  void runMigrations(process.env).then(
    () => console.info("Database migrations complete"),
    (error: unknown) => {
      console.error("Database migration failed", error);
      process.exitCode = 1;
    },
  );
}

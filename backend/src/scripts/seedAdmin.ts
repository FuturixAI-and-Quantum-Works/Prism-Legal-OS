import "../loadEnv.js";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { db, userProfiles, users } from "../db/index.js";
import { eq } from "drizzle-orm";
import { withScriptDatabase } from "./database.js";
import { parseSeedAdminEmail } from "./seedAdminInput.js";

export async function seedAdmin(email: string): Promise<boolean> {
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    return false;
  }

  await db
    .insert(userProfiles)
    .values({ userId: user.id, role: "admin" })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { role: "admin", updatedAt: new Date() },
    });
  return true;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href) {
  const email = parseSeedAdminEmail(process.argv.slice(2), process.env);
  if (process.argv.includes("--dry-run")) {
    console.info(`Validated explicit admin seed input for ${email}.`);
  } else {
    withScriptDatabase(process.env, () => seedAdmin(email))
      .then((updated) => {
        if (updated) {
          console.info(`Granted admin role to ${email}.`);
        } else {
          console.info(`User ${email} not found. Create an account first.`);
        }
      })
      .catch((error: unknown) => {
        console.error("Admin seeding failed.", error);
        process.exitCode = 1;
      });
  }
}

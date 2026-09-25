import "../loadEnv.js";
import { withScriptApplication } from "./database.js";
import { runMigrations } from "./migrate.js";
import { seedAiCatalog } from "./seedAiCatalog.js";
import { seedApprovalPolicies } from "./seedApprovalPolicies.js";
import { seedBundledDocxTemplates } from "./seedBundledDocxTemplates.js";
import { seedTemplates } from "./seedTemplates.js";
import { seedWorkflows } from "./seedWorkflows.js";

async function setup(): Promise<void> {
  await runMigrations(process.env);
  console.info("Database migrations complete");
  await withScriptApplication(process.env, async () => {
    await seedApprovalPolicies();
    await seedWorkflows();
    await seedAiCatalog();
    await seedTemplates();
    const bundledDocxCount = await seedBundledDocxTemplates();
    console.info(`Seeded ${bundledDocxCount} bundled DOCX templates`);
  });
  console.info("Prism setup complete");
}

setup().catch((error: unknown) => {
  console.error("Prism setup failed", error);
  process.exitCode = 1;
});

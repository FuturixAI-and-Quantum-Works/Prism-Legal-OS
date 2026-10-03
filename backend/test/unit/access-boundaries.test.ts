import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(import.meta.dirname, "../../src");

async function typescriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return typescriptFiles(target);
      return entry.isFile() && entry.name.endsWith(".ts") ? [target] : [];
    }),
  );
  return nested.flat();
}

describe("access architecture boundaries", () => {
  it("keeps database imports out of route and controller files", async () => {
    const files = (await typescriptFiles(sourceRoot)).filter(
      (file) =>
        file.includes(`${path.sep}routes${path.sep}`) ||
        file.endsWith(".routes.ts") ||
        file.endsWith(".controller.ts"),
    );
    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source, path.relative(sourceRoot, file)).not.toMatch(
        /from\s+["'][^"']*(?:\/db|db\/index|db\/schema)[^"']*["']/,
      );
    }
  });

  it("has no retired access helpers or JSON sharing fields", async () => {
    const files = await typescriptFiles(sourceRoot);
    const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
    expect(source).not.toMatch(
      /\b(checkProjectAccess|ensureDocAccess|ensureReviewAccess|listAccessibleProjectIds|getWorkspaceAccess|ensureWorkspaceAccess|findWorkspaceAccess)\b/,
    );
    expect(source).not.toMatch(/\b(projects|tabularReviews)\.sharedWith\b/);
  });

  it("keeps audited access decisions in the central authority", async () => {
    const files = [
      "modules/drive/drive.access-requests.service.ts",
      "lib/changeRequests.ts",
      "modules/documents/documents.service.ts",
      "modules/documents/documents.changes.service.ts",
      "modules/documents/documents.repository.ts",
      "modules/compliance/compliance.policy.ts",
      "modules/compliance/compliance.service.ts",
      "modules/compliance/compliance.review.repository.ts",
    ];
    const source = (
      await Promise.all(files.map((file) => readFile(path.join(sourceRoot, file), "utf8")))
    ).join("\n");

    expect(source).toMatch(/(?:accessAuthority|this\.authority)\.grants\.findGrant/);
    expect(source).not.toMatch(/workspace\.ownerId\s*===\s*input\.requestedByUserId/);
    expect(source).not.toMatch(/existingMember/);
    expect(source).not.toMatch(/document\.userId\s*!==\s*actor\.userId/);
    expect(source).not.toMatch(/allowsReview/);
    expect(source).not.toMatch(/findReview\(actor\.userId/);
    expect(source).not.toMatch(
      /\b(cancelChangeRequest|changeRequestStatus|changeRequestMessage)\b/,
    );
    expect(source).not.toMatch(
      /eq\(complianceReviews\.id,\s*reviewId\)[\s\S]{0,100}eq\(complianceReviews\.userId/,
    );
  });

  it("keeps workflow authorization decisions out of the workflow domain", async () => {
    const files = [
      "modules/workflows/workflows.service.ts",
      "modules/workflows/workflows.composition.ts",
      "modules/workflows/workflows.types.ts",
    ];
    const source = (
      await Promise.all(files.map((file) => readFile(path.join(sourceRoot, file), "utf8")))
    ).join("\n");

    expect(source).toMatch(/authority\.decide/);
    expect(source).toMatch(/authority\.decideKnownGrant/);
    expect(source).not.toMatch(/WorkflowsAuthorizationPolicy/);
    expect(source).not.toMatch(/grant\.(?:role|source)\s*[!=]==?/);
  });
});

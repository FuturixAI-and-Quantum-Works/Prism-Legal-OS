import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(repositoryRoot, "backend/src");
const legacyLocalNames = new Set(["userId", "userEmail", "userRole"]);

async function listTypeScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory()) return listTypeScriptFiles(path);
        return extname(entry.name) === ".ts" ? [path] : [];
      }),
  );
  return paths.flat();
}

function isLegacyLocal(node) {
  return (
    ts.isPropertyAccessExpression(node) &&
    legacyLocalNames.has(node.name.text) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "locals" &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === "res"
  );
}

function countLegacyLocals(sourceFile) {
  let count = 0;

  function visit(node) {
    if (isLegacyLocal(node)) {
      count += 1;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return count;
}

const offendingFiles = [];
let referenceCount = 0;

for (const path of await listTypeScriptFiles(sourceRoot)) {
  const source = await readFile(path, "utf8");
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const count = countLegacyLocals(sourceFile);
  if (count === 0) continue;
  offendingFiles.push(path);
  referenceCount += count;
}

if (referenceCount > 0) {
  for (const path of offendingFiles) {
    process.stderr.write(`${path.slice(repositoryRoot.length + 1)}\n`);
  }
  process.stderr.write(
    `Found ${referenceCount} legacy auth-local references across ${offendingFiles.length} files.\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("No legacy auth-local references found in backend source.\n");
}

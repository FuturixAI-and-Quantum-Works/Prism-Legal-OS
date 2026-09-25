import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(repositoryRoot, "backend/src");
const examplePath = "backend/.env.example";

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

function namesReadBySource() {
  const names = new Map();
  for (const path of sourceFiles(sourceRoot)) {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/\b(?:environment|process\.env)\.([A-Z][A-Z0-9_]*)\b/g)) {
      if (!names.has(match[1])) names.set(match[1], relative(repositoryRoot, path));
    }
  }
  return names;
}

function namesDocumentedByExample() {
  const example = readFileSync(resolve(repositoryRoot, examplePath), "utf8");
  return new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]));
}

export function checkEnvironmentExamples() {
  const read = namesReadBySource();
  const documented = namesDocumentedByExample();
  const findings = [
    ...[...read]
      .filter(([name]) => !documented.has(name))
      .map(([name, path]) => ({
        code: "undocumented",
        path: examplePath,
        message: `${name} is read by ${path} but missing from ${examplePath}`,
      })),
    ...[...documented]
      .filter((name) => !read.has(name))
      .map((name) => ({
        code: "unused",
        path: examplePath,
        message: `${name} is documented but not read under backend/src`,
      })),
  ];
  return { findings };
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const { findings } = checkEnvironmentExamples();
  if (findings.length === 0) {
    console.log("Environment example check passed.");
  } else {
    console.error(`Environment example check failed with ${findings.length} findings.`);
    for (const finding of findings) {
      console.error(`  - ${finding.path} [${finding.code}] ${finding.message}`);
    }
    process.exitCode = 1;
  }
}

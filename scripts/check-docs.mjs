import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicationDocuments = [
  "README.md",
  "CONTRIBUTORS.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "ARCHITECTURE.md",
  "docs/providers.md",
  "docs/backups-and-restore.md",
  "docs/pre-baseline-database-migration.md",
  "docs/template-catalog.md",
  "docs/template-license.md",
  "docs/deployment.md",
  "frontend/DESIGN_SYSTEM.md",
  "features/README.md",
  "features/ai-drafting/README.md",
  "features/contract-templates/README.md",
  "features/contract-review/README.md",
  "features/tabular-review/README.md",
  "features/review-playbooks/README.md",
  "features/document-editor/README.md",
  "features/review-and-approvals/README.md",
  "features/workspaces/README.md",
];
const requiredReadmeLinks = publicationDocuments.filter((document) => document !== "README.md");
const packageFiles = [
  "package.json",
  "backend/package.json",
  "frontend/package.json",
  "packages/protocol/package.json",
];
const packages = new Map(
  packageFiles.map((filename) => {
    const manifest = JSON.parse(readFileSync(path.join(root, filename), "utf8"));
    return [
      manifest.name,
      {
        directory: path.dirname(filename),
        scripts: new Set(Object.keys(manifest.scripts ?? {})),
      },
    ];
  }),
);
const rootPackage = packages.get("prism");
const automaticMigrationStatement =
  "The backend container runs migrations automatically before it starts the API.";
const migrationDocumentationContracts = new Map([
  [
    "README.md",
    {
      orderedCommands: [
        "cp .env.example .env",
        "docker compose up -d",
        "npm ci",
        "docker compose up -d postgres qdrant",
        "cp backend/.env.example backend/.env",
        "npm run setup --workspace @prism/backend",
        "npm run dev",
      ],
      requiredStatements: [automaticMigrationStatement],
    },
  ],
  [
    "docs/deployment.md",
    {
      orderedCommands: [],
      requiredStatements: [automaticMigrationStatement],
    },
  ],
]);
const stalePostgresInitializationClaim =
  /PostgreSQL initialization (?:directory|hook)|PostgreSQL volume applies the baseline|Compose service applies the (?:single )?Drizzle baseline/i;
const failures = [];

function fail(message) {
  failures.push(message);
}

function validateMigrationDocumentation(document, markdown) {
  const contract = migrationDocumentationContracts.get(document);
  if (!contract) return;

  let previousPosition = -1;
  for (const command of contract.orderedCommands) {
    const position = markdown.indexOf(command);
    if (position === -1) {
      fail(`${document} is missing required setup command ${command}`);
      continue;
    }
    if (position <= previousPosition) {
      fail(`${document} puts setup command out of order: ${command}`);
    }
    previousPosition = position;
  }

  for (const statement of contract.requiredStatements) {
    if (!markdown.includes(statement)) {
      fail(`${document} is missing required setup statement: ${statement}`);
    }
  }
  if (stalePostgresInitializationClaim.test(markdown)) {
    fail(`${document} claims PostgreSQL initialization applies the Drizzle baseline`);
  }
}

function markdownAnchor(value) {
  return value
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");
}

function anchorsIn(markdown) {
  const anchors = new Set();
  const occurrences = new Map();
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = markdownAnchor(match[1]);
    const count = occurrences.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    occurrences.set(base, count + 1);
  }
  return anchors;
}

function validateLinks(document, markdown) {
  for (const match of markdown.matchAll(/\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
    const rawTarget = match[1].replace(/^<|>$/g, "");
    if (/^(?:https?:|mailto:)/i.test(rawTarget)) continue;
    const [rawPath, rawFragment] = rawTarget.split("#", 2);
    const targetPath = path.resolve(
      root,
      path.dirname(document),
      decodeURIComponent(rawPath || ""),
    );
    if (!existsSync(targetPath)) {
      fail(`${document} links to missing path ${rawTarget}`);
      continue;
    }
    if (!rawFragment || !statSync(targetPath).isFile() || path.extname(targetPath) !== ".md") {
      continue;
    }
    const anchors = anchorsIn(readFileSync(targetPath, "utf8"));
    if (!anchors.has(decodeURIComponent(rawFragment))) {
      fail(`${document} links to missing heading ${rawTarget}`);
    }
  }
}

function workspaceFrom(command) {
  const match = command.match(/--workspace(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "prism";
}

function validateNpmCommand(document, command) {
  const match = command.match(/^npm run ([^\s\\]+)/);
  if (!match) return;
  const workspace = workspaceFrom(command);
  const packageEntry = packages.get(workspace);
  if (!packageEntry) {
    fail(`${document} uses unknown npm workspace ${workspace}`);
    return;
  }
  if (!packageEntry.scripts.has(match[1])) {
    fail(`${document} uses missing npm script ${match[1]} in ${workspace}`);
  }
}

function nodeScriptExists(script) {
  if (existsSync(path.resolve(root, script))) return true;
  const generatedBackendScript = script.match(/^backend\/dist\/(.+)\.js$/);
  return Boolean(
    generatedBackendScript &&
    existsSync(path.resolve(root, "backend/src", `${generatedBackendScript[1]}.ts`)),
  );
}

function validateShellCommands(document, markdown) {
  const commands = [];
  for (const block of markdown.matchAll(/```(?:sh|bash)\n([\s\S]*?)```/g)) {
    const logicalLines = block[1].replace(/\\\n\s*/g, " ").split("\n");
    commands.push(...logicalLines.map((line) => line.trim()).filter(Boolean));
  }
  commands.push(...[...markdown.matchAll(/`(npm run [^`\n]+)`/g)].map((match) => match[1].trim()));

  for (const command of commands) {
    if (command.startsWith("#")) continue;
    validateNpmCommand(document, command);

    const nodeScript = command.match(/^node\s+([^\s]+)/);
    if (nodeScript && !nodeScriptExists(nodeScript[1])) {
      fail(`${document} runs missing Node script ${nodeScript[1]}`);
    }

    const composeFile = command.match(/^docker compose\s+-f\s+([^\s]+)/);
    if (composeFile && !existsSync(path.resolve(root, composeFile[1]))) {
      fail(`${document} uses missing Compose file ${composeFile[1]}`);
    }
    if (
      command.startsWith("docker compose ") &&
      !composeFile &&
      !["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"].some((file) =>
        existsSync(path.resolve(root, file)),
      )
    ) {
      fail(`${document} uses Docker Compose but the repository has no default Compose file`);
    }

    const changedDirectory = command.match(/^cd\s+([^\s]+)/);
    if (
      changedDirectory &&
      !changedDirectory[1].includes("$") &&
      !existsSync(path.resolve(root, changedDirectory[1]))
    ) {
      fail(`${document} changes to missing directory ${changedDirectory[1]}`);
    }
  }
}

for (const document of publicationDocuments) {
  const documentPath = path.join(root, document);
  if (!existsSync(documentPath)) {
    fail(`Missing publication document ${document}`);
    continue;
  }
  const markdown = readFileSync(documentPath, "utf8");
  validateLinks(document, markdown);
  validateShellCommands(document, markdown);
  validateMigrationDocumentation(document, markdown);
}

if (rootPackage) {
  const readme = readFileSync(path.join(root, "README.md"), "utf8");
  for (const document of requiredReadmeLinks) {
    const relativeTarget = document.startsWith("docs/") ? document : `./${document}`;
    if (!readme.includes(`](${relativeTarget})`)) {
      fail(`README.md does not link to ${document}`);
    }
  }
}

const trackedDocx = execFileSync("git", ["ls-files"], {
  cwd: root,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(
    (filename) =>
      filename &&
      path.extname(filename).toLowerCase() === ".docx" &&
      existsSync(path.resolve(root, filename)),
  )
  .sort();
const catalogPath = path.join(root, "docs/template-catalog.md");
if (existsSync(catalogPath)) {
  const catalog = readFileSync(catalogPath, "utf8");
  const cataloguedDocx = [...catalog.matchAll(/^- `([^`]+\.docx)`/gim)]
    .map((match) => match[1])
    .sort();
  const uniqueCataloguedDocx = [...new Set(cataloguedDocx)];
  if (cataloguedDocx.length !== uniqueCataloguedDocx.length) {
    fail("The template catalog lists a DOCX path more than once");
  }
  const missing = trackedDocx.filter((filename) => !uniqueCataloguedDocx.includes(filename));
  const extra = uniqueCataloguedDocx.filter((filename) => !trackedDocx.includes(filename));
  if (missing.length) fail(`Template catalog is missing: ${missing.join(", ")}`);
  if (extra.length) fail(`Template catalog has untracked paths: ${extra.join(", ")}`);
}

if (failures.length) {
  console.error(`Documentation check failed with ${failures.length} problem(s).`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `Documentation check passed for ${publicationDocuments.length} documents and ${trackedDocx.length} tracked DOCX files.`,
);

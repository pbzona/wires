// Extracts every self-contained TypeScript example from the docs, type-checks
// them against the workspace `@pbzona/wires` package, then runs each one with Node.
//
// A code block is checked when its language is `ts` or `typescript` and its
// first statement imports from "@pbzona/wires" or "@pbzona/wires/components".
// Fragments that don't start with an import are documentation-only and skipped.
//
// Run: pnpm --filter docs test   (requires `@pbzona/wires` to be built; turbo does this)
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { extractSnippets } from "./extract-snippets.ts";

const docsRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(docsRoot, ".snippets");
const SKIP_DIRS = new Set(["node_modules", ".snippets", ".turbo", "scripts"]);

function findPages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : findPages(path);
    return entry.name.endsWith(".mdx") ? [path] : [];
  });
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const snippets = findPages(docsRoot).sort().flatMap((page) =>
  extractSnippets(relative(docsRoot, page), readFileSync(page, "utf8")),
);
for (const s of snippets) writeFileSync(join(outDir, s.file), `${s.code}\n`);
console.log(`Found ${snippets.length} runnable snippets`);

const tsc = join(docsRoot, "node_modules", "typescript", "bin", "tsc");
const typecheck = spawnSync(process.execPath, [tsc, "-p", join(docsRoot, "tsconfig.json")], { stdio: "inherit" });
if (typecheck.status !== 0) {
  console.error("Type errors in documentation snippets (see .snippets/<page>__L<line>.ts)");
  process.exit(1);
}
console.log("Type check passed");

let failures = 0;
for (const s of snippets) {
  const run = spawnSync(process.execPath, [join(outDir, s.file)], { encoding: "utf8", cwd: docsRoot });
  if (run.status === 0) continue;
  failures++;
  console.error(`\n✗ ${s.page}:${s.line}\n${run.stderr || run.stdout}`);
}
if (failures > 0) {
  console.error(`\n${failures} of ${snippets.length} snippets failed`);
  process.exit(1);
}
console.log(`All ${snippets.length} snippets ran successfully`);

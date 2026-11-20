// Extracts every self-contained TypeScript example from the docs, type-checks
// them against the workspace `@pbzona/wires` package, then runs each one with Node.
//
// A code block is checked when its language is `ts` or `typescript` and its
// first line is an `import` from "@pbzona/wires" or "@pbzona/wires/components".
// Fragments that don't start with an import are documentation-only and skipped.
//
// Run: pnpm --filter docs test   (requires `@pbzona/wires` to be built; turbo does this)
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

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

type Snippet = { page: string; line: number; file: string; code: string };

function extract(page: string): Snippet[] {
  const lines = readFileSync(page, "utf8").split("\n");
  const snippets: Snippet[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)```(ts|typescript)\b/.exec(lines[i]!);
    if (!open) continue;
    const indent = open[1]!.length;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && !/^\s*```\s*$/.test(lines[j]!); j++) body.push(lines[j]!.slice(indent));
    const code = body.join("\n");
    if (/^import\b[^\n]*from "@pbzona\/wires(\/components)?";/.test(code)) {
      const name = relative(docsRoot, page).replace(/\.mdx$/, "").replace(/[\\/]/g, "__");
      snippets.push({ page: relative(docsRoot, page), line: i + 1, file: `${name}__L${i + 1}.ts`, code });
    }
    i = j;
  }
  return snippets;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
const snippets = findPages(docsRoot).sort().flatMap(extract);
for (const s of snippets) writeFileSync(join(outDir, s.file), `${s.code}\n`);
console.log(`Found ${snippets.length} runnable snippets`);

const tsc = join(docsRoot, "node_modules", ".bin", "tsc");
const typecheck = spawnSync(tsc, ["-p", join(docsRoot, "tsconfig.json")], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
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

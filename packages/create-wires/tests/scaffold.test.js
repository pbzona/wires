import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../bin/create-wires.js", import.meta.url));
function run(cwd, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}
async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), "create-wires-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test("creates a standalone project in a new directory, without installing anything", async t => {
  const dir = await workspace(t);
  const first = run(dir, "My-Lab");
  assert.equal(first.status, 0, first.stderr);
  const root = join(dir, "My-Lab");
  const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(manifest.name, "my-lab");
  assert.deepEqual(manifest.dependencies, { "@pbzona/wires": "^0.2.1", "@pbzona/wires-editor": "^0.2.1" });
  const files = await readdir(root);
  for (const name of ["chips", "examples", "src", "index.html", "vite.config.ts", "README.md", ".gitignore"]) {
    assert.ok(files.includes(name), `missing ${name}`);
  }
  assert.ok(!files.includes("node_modules"));
  const html = await readFile(join(root, "index.html"), "utf8");
  assert.match(html, /<link rel="icon"[^>]* href="\/favicon\.svg"/);
  const favicon = await readFile(join(root, "public/favicon.svg"), "utf8");
  assert.equal(favicon, await readFile(new URL("../../../apps/docs/favicon.svg", import.meta.url), "utf8"));
  const example = await readFile(join(root, "examples/Adder4.ts"), "utf8");
  assert.equal(example, await readFile(new URL("../../wires/examples/Adder4.ts", import.meta.url), "utf8"));
  const demo = spawnSync(process.execPath, [fileURLToPath(new URL("../../wires/examples/Adder4.ts", import.meta.url))], { encoding: "utf8" });
  assert.equal(demo.status, 0, demo.stderr);
  assert.equal(demo.stdout, "", "an imported example must not run the demo");
});

test("defaults to my-lab and refuses to overwrite it on a second run", async t => {
  const dir = await workspace(t);
  assert.equal(run(dir).status, 0);
  assert.deepEqual(await readdir(dir), ["my-lab"]);
  const file = join(dir, "my-lab/README.md");
  await writeFile(file, "My notes");
  const again = run(dir);
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /empty directory/i);
  assert.equal(await readFile(file, "utf8"), "My notes");
});

test("accepts an existing empty directory, never merges with a previous scaffold", async t => {
  const dir = await workspace(t);
  assert.equal(run(dir, ".").status, 0);
  const source = join(dir, "chips/BufferGate.ts");
  await writeFile(source, "// learner edits\n");
  const again = run(dir, ".");
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /empty directory/i);
  assert.equal(await readFile(source, "utf8"), "// learner edits\n");
});

test("refuses non-empty directories (including hidden files), ordinary files and symlinks", async t => {
  const dir = await workspace(t);
  await mkdir(join(dir, "hidden"));
  await writeFile(join(dir, "hidden/.keep"), "mine");
  assert.notEqual(run(dir, "hidden").status, 0);
  assert.deepEqual(await readdir(join(dir, "hidden")), [".keep"]);
  await writeFile(join(dir, "lab"), "mine");
  assert.notEqual(run(dir, "lab").status, 0);
  assert.equal(await readFile(join(dir, "lab"), "utf8"), "mine");
  await mkdir(join(dir, "empty"));
  await symlink(join(dir, "empty"), join(dir, "link"), "dir");
  assert.notEqual(run(dir, "link").status, 0);
  assert.deepEqual(await readdir(join(dir, "empty")), []);
});

#!/usr/bin/env node
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const template = fileURLToPath(new URL("../template/", import.meta.url));
const usage = "Usage: npm create @pbzona/wires [project-directory] (default: my-lab)";

async function scaffold(target) {
  // Refuse even hidden files, and don't follow an existing target symlink.
  await mkdir(target, { recursive: true });
  if (!(await lstat(target)).isDirectory() || (await readdir(target)).length) {
    throw new Error(`Not an empty directory: ${target}. Choose a new or empty directory.`);
  }
  // Keep npm's package name independent of unusual (but valid) folder names.
  const folderName = basename(target).toLowerCase();
  const packageName = /^[a-z0-9][a-z0-9._-]{0,213}$/.test(folderName) ? folderName : "wires-lab";

  async function copyDirectory(src, dest) {
    for (const file of await readdir(src, { withFileTypes: true })) {
      const from = join(src, file.name);
      const to = join(dest, file.name === "gitignore" ? ".gitignore" : file.name);
      if (file.isDirectory()) {
        await mkdir(to); // refuse a collision, including a symlink
        await copyDirectory(from, to);
      } else if (file.name === "package.json" && src === template) {
        const { default: manifest } = await import("../template/package.json", { with: { type: "json" } });
        await writeFile(to, JSON.stringify({ ...manifest, name: packageName }, null, 2) + "\n", { flag: "wx" });
      } else {
        await copyFile(from, to, constants.COPYFILE_EXCL);
      }
    }
  }
  await copyDirectory(template, target);
}

const [directory = "my-lab", ...extra] = process.argv.slice(2);
if (!extra.length && ["-h", "--help"].includes(directory)) {
  console.log(usage);
} else if (extra.length || !directory || directory.startsWith("-")) {
  console.error(usage);
  process.exitCode = 1;
} else {
  try {
    const target = resolve(directory);
    await scaffold(target);
    console.log(`Created ${target}\nIn that directory, run npm install and then npm run dev.`);
  } catch (error) {
    console.error(`create-wires: ${error.message}`);
    process.exitCode = 1;
  }
}

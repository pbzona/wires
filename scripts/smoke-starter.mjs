// Run from a built checkout. Never install into or link to the checkout itself.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { accessSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values: { dev, online, help, tarballs } } = parseArgs({ options: {
  dev: { type: 'boolean' }, online: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, tarballs: { type: 'string' },
} });
if (help) {
  console.log('Usage: node scripts/smoke-starter.mjs [--dev] [--online] [--tarballs DIR]\nDefault: pack from the checkout and smoke test offline. --tarballs: test existing release archives. --dev: keep project and serve locally. --online: fetch missing tooling.');
  process.exit(0);
}

const packages = fileURLToPath(new URL('../packages/', import.meta.url));
const libraries = ['wires', 'wires-editor'];
if (!tarballs) {
  // Packing skips prepack so running this script cannot rebuild the workspace.
  for (const name of libraries) {
    for (const file of ['index.js', 'index.d.ts']) accessSync(join(packages, name, 'dist', file));
  }
}

const scratch = mkdtempSync(join(tmpdir(), 'wires-smoke-'));
const app = join(scratch, 'my-lab');
console.log(`Temporary directory: ${scratch}`);
function run(cwd, command, ...args) {
  console.log(`> ${command} ${args.join(' ')}`);
  execFileSync(command, args, { cwd, stdio: 'inherit' });
}

try {
  for (const name of [...libraries, 'create-wires']) {
    const destination = join(scratch, `${name}.tgz`);
    if (tarballs) {
      const { version } = JSON.parse(readFileSync(join(packages, name, 'package.json'), 'utf8'));
      copyFileSync(join(tarballs, `pbzona-${name}-${version}.tgz`), destination);
    } else {
      run(join(packages, name), 'pnpm', '--config.ignore-scripts=true', 'pack', '--out', destination);
    }
  }
  // Exercise exactly the bin and template a registry consumer would receive.
  run(scratch, 'tar', '-xzf', 'create-wires.tgz');
  run(scratch, process.execPath, 'package/bin/create-wires.js', 'my-lab');

  // Change just the two unpublished/local library specs in the generated app.
  // The editor consumes the app's wires through its ordinary peer dependency.
  const manifestPath = join(app, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const name of libraries) {
    const id = `@pbzona/${name}`;
    assert.ok(manifest.dependencies?.[id], `Starter is missing dependency ${id}`);
    manifest.dependencies[id] = `file:../${name}.tgz`;
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  run(app, 'pnpm', 'install', online ? '--prefer-offline' : '--offline',
    ...(tarballs ? ['--registry=https://registry.npmjs.org/'] : []),
    '--ignore-workspace', '--no-frozen-lockfile', '--ignore-scripts', '--strict-peer-dependencies');

  // Resolve imports FROM the consumer, not relative to this script's checkout.
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { realpathSync } from 'node:fs';
    import { elaborate } from '@pbzona/wires';
    import { Adder4 } from './examples/Adder4.ts';
    const wiresFrom = url => realpathSync(createRequire(url).resolve('@pbzona/wires/package.json'));
    assert.equal(wiresFrom(import.meta.url), wiresFrom(import.meta.resolve('@pbzona/wires-editor')));
    assert.ok(elaborate(Adder4).gates.length > 0);
  `], { cwd: app, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  assert.equal(output, '', 'Importing the example should not print demo output');
  console.log('Imported and elaborated Adder4 with no demo output; editor and app resolve the same wires.');
  run(app, 'pnpm', 'exec', 'tsc', '--noEmit');
  run(app, 'pnpm', 'run', 'build');
  accessSync(join(app, 'dist', 'index.html'));
  console.log('Starter smoke passed.');

  if (dev) {
    console.log(`Keeping ${app} for the demo. Stop Vite with Ctrl-C.`);
    run(app, 'pnpm', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5173', '--strictPort');
  } else {
    rmSync(scratch, { recursive: true });
  }
} catch (error) {
  console.error(`Temporary files kept at ${scratch}`);
  console.error(error.message);
  process.exitCode = 1;
}

// Turbo owns the order and the checks. This task handles one verified archive.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [mode, ...extra] = process.argv.slice(2);
if (!['--dry-run', '--publish'].includes(mode) || extra.length) {
  throw new Error('Choose --dry-run or --publish explicitly.');
}
const { name, version, publishConfig, private: isPrivate } = JSON.parse(readFileSync('package.json', 'utf8'));
const registry = 'https://registry.npmjs.org/';
if (isPrivate || publishConfig?.access !== 'public' || publishConfig.registry !== registry) {
  throw new Error(`Not a public npm release package: ${name}`);
}
const file = `../../dist/npm/${name.replace('@', '').replace('/', '-')}-${version}.tgz`;
const args = ['publish', file, '--access=public', `--registry=${registry}`];

// Every published version gets an annotated git tag such as @pbzona/wires@0.2.1, pushed to origin.
const tag = `${name}@${version}`;
const git = (...gitArgs) => execFileSync('git', gitArgs, { encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD');
let tagged = null;
try {
  tagged = git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`);
} catch {
  // No such tag yet.
}
function tagRelease() {
  if (tagged === null) {
    git('tag', '--annotate', tag, '--message', `Release ${tag}`);
    console.log(`Tagged ${tag} at ${head}.`);
  }
  execFileSync('git', ['push', 'origin', `refs/tags/${tag}`], { stdio: 'inherit' });
}

if (mode === '--dry-run') {
  args.push('--dry-run', '--offline');
  console.log(tagged === null ? `Would tag ${tag} at ${head} and push it to origin.` : `Tag ${tag} already exists at ${tagged}.`);
} else {
  if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) {
    throw new Error('Commit the intended changes and release from a clean worktree.');
  }
  // A retry after a partial release must not republish a dependency, or silently
  // skip an unrelated tarball that happens to have the same name and version.
  const published = await fetch(`${registry}${encodeURIComponent(name)}/${encodeURIComponent(version)}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (published.ok) {
    const { dist } = await published.json();
    const integrity = 'sha512-' + createHash('sha512').update(readFileSync(file)).digest('base64');
    if (dist.integrity !== integrity) throw new Error(`${name}@${version} already exists with different contents.`);
    console.log(`${name}@${version} is already published with matching integrity; skipping.`);
    // A retry still tags a version whose tagging failed. An existing tag is kept wherever it points.
    tagRelease();
    process.exit(0);
  }
  if (published.status !== 404) throw new Error(`Cannot check ${name}@${version}: registry returned ${published.status}.`);
  if (tagged !== null && tagged !== head) throw new Error(`Tag ${tag} already points at ${tagged}, not HEAD (${head}).`);
}
execFileSync('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
if (mode === '--publish') tagRelease();

import { WiresError } from "./errors.js";

/**
 * wires only supports maintained Node.js releases: 24, or 26 and later.
 *
 * Nothing in the library needs a newer Node.js; this is a policy. `engines` in
 * package.json only produces a warning, so the check runs when the package is
 * imported. Runtimes that report a Node.js version (Bun, Deno) are checked the
 * same way, and browsers, which have no `process`, are not checked at all.
 */
export function checkNodeVersion(version: string | undefined): void {
  if (version === undefined) return;
  const major = Number(version.split(".")[0]);
  if (major < 24 || major === 25) {
    throw new WiresError(
      `@pbzona/wires requires Node.js 24, or 26 and later (found ${version}). ` +
        `End-of-life Node.js releases are not supported.`,
    );
  }
}

const runtime = globalThis as { process?: { versions?: { node?: string } } };
checkNodeVersion(runtime.process?.versions?.node);

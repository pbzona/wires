import { lstat, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { TLSSocket } from "node:tls";
import { parseSync } from "rolldown/utils";

const maxBytes = 128 * 1024;

function fromLocalWorkbench(req: IncomingMessage): boolean {
  const { host, origin } = req.headers;
  const site = req.headers["sec-fetch-site"];
  const peer = req.socket.remoteAddress;
  const localPeer = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
  const protocol = req.socket instanceof TLSSocket ? "https" : "http";
  return localPeer && typeof host === "string" && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/.test(host) &&
    origin === `${protocol}://${host}` && (site === undefined || site === "same-origin");
}

function isChipName(name: unknown): name is string {
  // One portable filename stem. Never sanitize a name into a different binding.
  return typeof name === "string" && name.length <= 128 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
    name !== "__proto__" && !/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(name);
}

function exportsChip(name: string, source: string): boolean {
  // Parse, don't import or execute. A matching comment/string isn't an export.
  const parsed = parseSync(`${name}.ts`, source, { sourceType: "module", showSemanticErrors: true });
  return !parsed.errors.length && parsed.program.body.some(statement => {
    if (statement.type !== "ExportNamedDeclaration") return false;
    const decl = statement.declaration;
    return decl?.type === "VariableDeclaration" && decl.kind === "const" &&
      decl.declarations.some(binding => binding.id.type === "Identifier" && binding.id.name === name && binding.init != null);
  });
}

export function saveChip(root: string) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    if (req.url !== "/__wires/save") return next();
    function reply(status: number, message: string) {
      res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end(message);
    }
    if (req.method !== "POST") return reply(405, "Use POST to save a chip.");
    if (!fromLocalWorkbench(req)) return reply(403, "Saving is only available from the local workbench.");
    if (req.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
      return reply(415, "Use an application/json request.");
    }

    let payload;
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > maxBytes) {
          req.resume();
          return reply(413, "This chip exceeds the 128 KiB save limit.");
        }
        chunks.push(chunk);
      }
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return reply(400, "Invalid JSON request.");
    }
    const { name, source } = payload ?? {};
    if (!isChipName(name)) {
      return reply(400, "Use a chip name that is also a portable file name: an identifier of at most 128 characters, " +
        "not a reserved device name such as Con, Aux or Nul.");
    }
    if (typeof source !== "string" || !exportsChip(name, source)) {
      return reply(400, "Use a new chip name matching the generated TypeScript export.");
    }
    try {
      const directory = join(root, "chips");
      if (!(await lstat(directory)).isDirectory()) return reply(400, "chips/ must be a local directory, not a link.");
      // Exclusive creation also rejects existing symlinks (including dangling ones).
      await writeFile(join(directory, `${name}.ts`), source, { flag: "wx" });
      return reply(201, `Created chips/${name}.ts`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return reply(409, `chips/${name}.ts already exists. Choose another name.`);
      return reply(500, "Couldn't create the file. Check that chips/ exists and is writable.");
    }
  };
}

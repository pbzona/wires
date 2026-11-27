import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { saveChip } from "../template/dev/save-chip.ts";

async function localWorkbench(t) {
  const dir = await mkdtemp(join(tmpdir(), "wires-save-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "chips"));
  const middleware = saveChip(dir);
  const server = createServer((req, res) => middleware(req, res, () => { res.writeHead(404); res.end(); }));
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  function post(body, headers = {}, method = "POST", path = "/__wires/save") {
    return fetch(origin + path, {
      method,
      headers: { origin, "content-type": "application/json", ...headers },
      ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    });
  }
  return { dir, post, origin };
}

const source = `import { circuit } from "@pbzona/wires";\n\nexport const NewChip = circuit(\n  { name: "NewChip", inputs: ["a"], outputs: ["out"] },\n  ({ inputs, output }) => output("out", inputs.a),\n);\n`;
const valid = { name: "NewChip", source };

test("saves the exact TS source and a simultaneous second save cannot replace it", async t => {
  const { dir, post } = await localWorkbench(t);
  const variants = [source, source + "// second version\n"];
  const responses = await Promise.all(variants.map(source => post({ name: valid.name, source })));
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  const original = variants[responses.findIndex(r => r.status === 201)];
  assert.equal(await readFile(join(dir, "chips/NewChip.ts"), "utf8"), original);
  assert.deepEqual(await readdir(join(dir, "chips")), ["NewChip.ts"]);
});

test("rejects paths, reserved names and source without the exact matching exported const", async t => {
  const { dir, post } = await localWorkbench(t);
  for (const name of ["../NewChip", "a/b", "a\\b", "NewChip.ts", "9first", "__proto__", "LPT1", "class", "yield", "eval"]) {
    const response = await post({ name, source: `export const ${name} = 1;` });
    assert.equal(response.status, 400, name);
  }
  // A valid identifier that isn't a portable file name says so, rather than blaming the source.
  for (const name of ["Aux", "Con", "a".repeat(129)]) {
    const response = await post({ name, source: `export const ${name} = 1;` });
    assert.equal(response.status, 400, name);
    assert.match(await response.text(), /portable file name/, name);
  }
  for (const source of ["// export const NewChip = 1;", 'export const Other = "export const NewChip = 1;";',
    "const NewChip = 1;", "export const NewChipSuffix = 1;", "export const NewChip = ;"]) {
    assert.equal((await post({ name: valid.name, source })).status, 400, source);
  }
  for (const payload of ["not json", "null", [], {}, { name: "a", source: 2 }]) {
    assert.equal((await post(payload)).status, 400);
  }
  assert.deepEqual(await readdir(join(dir, "chips")), []);
});

test("requires a local host, matching origin, same-origin Fetch Metadata, POST and JSON", async t => {
  const { dir, post, origin } = await localWorkbench(t);
  for (const headers of [{ origin: "" }, { origin: "https://elsewhere.invalid" }, { origin: origin + ":1" },
    { "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }]) {
    assert.equal((await post(valid, headers)).status, 403);
  }
  assert.equal((await post(valid, { "content-type": "text/plain" })).status, 415);
  assert.equal((await post(valid, {}, "GET")).status, 405);
  assert.equal((await post(valid, {}, "POST", "/elsewhere")).status, 404);
  // A non-loopback peer or virtual host isn't trusted even if the origin matches.
  for (const [host, remoteAddress] of [["example.invalid", "127.0.0.1"], ["localhost", "192.0.2.1"]]) {
    let status;
    await saveChip(dir)({ method: "POST", url: "/__wires/save", headers: { host, origin: `http://${host}` }, socket: { remoteAddress } },
      { writeHead(code) { status = code; }, end() {} }, assert.fail);
    assert.equal(status, 403);
  }
  assert.deepEqual(await readdir(join(dir, "chips")), []);
});

test("caps a streaming request without trusting Content-Length", async t => {
  const { dir, origin } = await localWorkbench(t);
  const status = await new Promise((resolve, reject) => {
    const req = request(origin + "/__wires/save", { method: "POST", headers: { origin, "content-type": "application/json" } }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", reject);
    req.write(" ".repeat(64 * 1024));
    req.end(" ".repeat(65 * 1024));
  });
  assert.equal(status, 413);
  assert.deepEqual(await readdir(join(dir, "chips")), []);
});

test("does not follow a symlink at the chip filename or chips directory", async t => {
  const { dir, post } = await localWorkbench(t);
  await mkdir(join(dir, "outside"));
  await symlink(join(dir, "outside/NewChip.ts"), join(dir, "chips/NewChip.ts"));
  assert.equal((await post(valid)).status, 409);
  await rename(join(dir, "chips"), join(dir, "old-chips"));
  await symlink(join(dir, "outside"), join(dir, "chips"), "dir");
  assert.equal((await post(valid)).status, 400);
  assert.deepEqual(await readdir(join(dir, "outside")), []);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSnippets } from "./extract-snippets.ts";

const extract = (code: string) => extractSnippets("example.mdx", `\`\`\`ts\n${code}\n\`\`\``);

for (const code of [
  `import { gate } from '@pbzona/wires';`,
  `import { AND } from "@pbzona/wires/components"`,
  `import {\n  gate,\n  simulate,\n} from "@pbzona/wires";`,
]) {
  test(`includes ${JSON.stringify(code)}`, () => {
    assert.deepEqual(extract(code).map((snippet) => snippet.code), [code]);
  });
}

test("skips fragments and examples whose first import is unrelated", () => {
  assert.deepEqual(extract(`const out = state.read("out");`), []);
  assert.deepEqual(extract(`import x from "elsewhere";\nimport { gate } from "@pbzona/wires";`), []);
});

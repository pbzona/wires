type Snippet = { page: string; line: number; file: string; code: string };

/** Extract self-contained examples from one docs page, keeping its source locations. */
export function extractSnippets(page: string, text: string): Snippet[] {
  const lines = text.split("\n");
  const snippets: Snippet[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)```(ts|typescript)\b/.exec(lines[i]!);
    if (!open) continue;
    const indent = open[1]!.length;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && !/^\s*```\s*$/.test(lines[j]!); j++) body.push(lines[j]!.slice(indent));
    const code = body.join("\n");
    // Match the first import only, allowing its list of names to span lines.
    if (/^\s*import\b[^'";]*?\bfrom\s*(['"])@pbzona\/wires(?:\/components)?\1/.test(code)) {
      const name = page.replace(/\.mdx$/, "").replace(/[\\/]/g, "__");
      snippets.push({ page, line: i + 1, file: `${name}__L${i + 1}.ts`, code });
    }
    i = j;
  }
  return snippets;
}

// Pre-renders docs/SCOPE.md into scope.html. Usage: npm i marked && node scripts/render-scope.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { marked } from "marked";

const md = readFileSync(new URL("../docs/SCOPE.md", import.meta.url), "utf8");
const renderer = new marked.Renderer();
const baseCode = renderer.code.bind(renderer);
renderer.code = (code, lang, escaped) =>
  lang === "mermaid" ? `<pre class="mermaid">${code.replace(/</g, "&lt;")}</pre>` : baseCode(code, lang, escaped);
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
renderer.heading = (text, level) => `<h${level} id="${slug(text)}">${text}</h${level}>\n`;
const body = marked.parse(md, { renderer, gfm: true });

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Contract Scope · The Gold Reserve</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="nav"><a href="/" class="brand">◆ The Gold Reserve</a><nav><a href="/">Home</a><a href="/docs/SCOPE.md">Raw markdown</a></nav></header>
<main class="doc">
${body}
</main>
<footer class="foot">Draft scope. Nothing described here is deployed yet.</footer>
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs";
mermaid.initialize({ startOnLoad: true, theme: "dark" });
</script>
</body>
</html>
`;
writeFileSync(new URL("../scope.html", import.meta.url), html);
console.log("wrote scope.html");

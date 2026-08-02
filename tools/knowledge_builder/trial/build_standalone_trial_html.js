#!/usr/bin/env node
/* Produces the trial package's standalone copy of knowledge_builder_tool_v0.2.0-alpha.html.
 *
 * The product HTML (tools/knowledge_builder/ui/knowledge_builder_tool_v0.2.0-alpha.html) is
 * never modified by this script - it is only READ. In its normal location it loads several
 * sibling files via <script src="..."> (relative paths into ../core/, vendor/, and
 * ../../quantity_sidecar_binding_core.js). Checkpoint 5's trial package requires the tool to
 * live as a single file directly under trial_package/ alongside case data/README/guide, with
 * no dependency on files outside that folder. Since editing the product HTML's <script src>
 * tags is forbidden (Checkpoint 5 §10), this script instead inlines the unmodified contents of
 * each referenced file into a same-order <script> block, byte-for-byte, and writes the result
 * to trial_package/knowledge_builder_tool_v0.2.0-alpha.html. This is packaging only - it does
 * not alter product logic (identical to a browser fetching+running the same external scripts).
 * pdf.js's worker (vendor/pdfjs/pdf.worker.min.js) is loaded via `new Worker(workerSrc)` at
 * runtime and cannot be inlined into the document, so it is copied alongside as an actual file
 * at trial_package/vendor/pdfjs/pdf.worker.min.js (workerSrc is set as a path relative to the
 * document itself, not to any <script>, so this placement matches the HTML unmodified).
 * Run: node tools/knowledge_builder/trial/build_standalone_trial_html.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const UI_DIR = path.join(__dirname, '..', 'ui');
const SRC_HTML = path.join(UI_DIR, 'knowledge_builder_tool_v0.2.0-alpha.html');
const OUT_HTML = path.join(__dirname, 'trial_package', 'knowledge_builder_tool_v0.2.0-alpha.html');
const OUT_WORKER_DIR = path.join(__dirname, 'trial_package', 'vendor', 'pdfjs');

function inlineScripts(html) {
  const scriptSrcRe = /<script src="([^"]+)"><\/script>/g;
  let inlinedCount = 0;
  const result = html.replace(scriptSrcRe, (match, src) => {
    const resolved = path.resolve(UI_DIR, src);
    const content = fs.readFileSync(resolved, 'utf8');
    inlinedCount++;
    return `<script>\n${content}\n</script>`;
  });
  return { result, inlinedCount };
}

function main() {
  const original = fs.readFileSync(SRC_HTML, 'utf8');
  const { result, inlinedCount } = inlineScripts(original);
  if (inlinedCount === 0) throw new Error('インライン化対象の<script src>が見つかりません。product HTMLの構造が変わっていないか確認してください。');
  fs.mkdirSync(path.dirname(OUT_HTML), { recursive: true });
  fs.writeFileSync(OUT_HTML, result, 'utf8');

  fs.mkdirSync(OUT_WORKER_DIR, { recursive: true });
  fs.copyFileSync(path.join(UI_DIR, 'vendor', 'pdfjs', 'pdf.worker.min.js'), path.join(OUT_WORKER_DIR, 'pdf.worker.min.js'));

  console.log(`Inlined ${inlinedCount} external script(s) into ${path.relative(process.cwd(), OUT_HTML)}`);
  console.log(`Copied pdf.worker.min.js into ${path.relative(process.cwd(), OUT_WORKER_DIR)}`);
}

main();

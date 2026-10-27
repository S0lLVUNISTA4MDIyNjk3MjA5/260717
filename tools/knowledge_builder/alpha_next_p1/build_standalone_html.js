#!/usr/bin/env node
/* Alpha Next P1 (feedback-independent, non-runtime work): produces a standalone-inlined copy
 * of the UNMODIFIED product HTML for use inside this package's Case A/B re-run and the
 * candidate package build. This is a fresh script (not an edit of
 * tools/knowledge_builder/trial/build_standalone_trial_html.js, which is part of the frozen
 * evaluation baseline and is left untouched) that applies the same read-only inlining
 * technique: it only READS tools/knowledge_builder/ui/knowledge_builder_tool_v0.2.0-alpha.html
 * and its <script src="..."> dependencies, and writes a new file elsewhere. No runtime/product
 * file is modified by this script.
 * Run: node tools/knowledge_builder/alpha_next_p1/build_standalone_html.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const UI_DIR = path.join(__dirname, '..', 'ui');
const SRC_HTML = path.join(UI_DIR, 'knowledge_builder_tool_v0.2.0-alpha.html');

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

function build(outHtmlPath, outWorkerDir) {
  const original = fs.readFileSync(SRC_HTML, 'utf8');
  const { result, inlinedCount } = inlineScripts(original);
  if (inlinedCount === 0) throw new Error('インライン化対象の<script src>が見つかりません。product HTMLの構造が変わっていないか確認してください。');
  fs.mkdirSync(path.dirname(outHtmlPath), { recursive: true });
  fs.writeFileSync(outHtmlPath, result, 'utf8');

  fs.mkdirSync(outWorkerDir, { recursive: true });
  fs.copyFileSync(path.join(UI_DIR, 'vendor', 'pdfjs', 'pdf.worker.min.js'), path.join(outWorkerDir, 'pdf.worker.min.js'));
  return inlinedCount;
}

module.exports = { build, SRC_HTML };

if (require.main === module) {
  const outHtmlPath = path.join(__dirname, 'work', 'knowledge_builder_tool_v0.2.0-alpha.html');
  const outWorkerDir = path.join(__dirname, 'work', 'vendor', 'pdfjs');
  const inlinedCount = build(outHtmlPath, outWorkerDir);
  console.log(`Inlined ${inlinedCount} external script(s) into ${path.relative(process.cwd(), outHtmlPath)}`);
  console.log(`Copied pdf.worker.min.js into ${path.relative(process.cwd(), outWorkerDir)}`);
}

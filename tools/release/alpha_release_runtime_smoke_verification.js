/* Alpha Release Gate 1 - Checkpoint 1: real-library runtime smoke verification.
 * Loads the actual vendored Cytoscape.js / SheetJS xlsx / TinySegmenter files
 * from the completed dist/ build (not from tools/design_notes/node_modules,
 * not from tools/release/vendor/ directly, and never a fake/stub) and drives
 * each library through a minimal real operation. No fake Cytoscape is used
 * anywhere in this file (unlike the existing Checkpoint 2/3 Playwright suites,
 * which intentionally stub cytoscape/tiny-segmenter to keep those tests
 * focused on B-4b logic -- this file exists specifically to cover what those
 * suites do not: the vendored third-party libraries' own real behavior).
 * Also verifies the product's existing character-type-chunk fallback (already
 * implemented in the product HTML, not new code) actually engages when
 * TinySegmenter fails to load, via the observable #segmenterStatus text. */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DIST_DIR = path.join(__dirname, '..', '..', 'dist', 'json_ab_trace_matching_tool_v12.1.15-alpha-build');
const DIST_HTML_PATH = path.join(DIST_DIR, 'json_ab_trace_matching_tool_v12.1.15.html');
const RUNTIME_DIR = path.join(DIST_DIR, 'runtime');

const checks = [];
function check(name, condition, detail) { checks.push({ name, ok: !!condition, detail }); }

async function main() {
  if (!fs.existsSync(DIST_HTML_PATH)) {
    console.error(`dist build not found at ${DIST_HTML_PATH}. Run tools/release/build_alpha_release.js first.`);
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch();

  // ── Cytoscape.js: real library, no fake, loaded from dist/runtime/ ──
  {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    // Blank page + the real vendored file only (not the whole product app):
    // this is a focused smoke test of the vendored library itself, sourced
    // from the completed dist build as required.
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ path: path.join(RUNTIME_DIR, 'cytoscape-3.26.0.min.js') });
    const result = await page.evaluate(() => {
      const out = { typeofCytoscape: typeof cytoscape, version: cytoscape.version };
      const cy = cytoscape({
        headless: true,
        elements: {
          nodes: [{ data: { id: 'n1' } }, { data: { id: 'n2' } }],
          edges: [{ data: { id: 'e1', source: 'n1', target: 'n2' } }]
        }
      });
      out.nodeCount = cy.nodes().length;
      out.edgeCount = cy.edges().length;
      let destroyThrew = false;
      try { cy.destroy(); } catch (_) { destroyThrew = true; }
      out.destroyThrew = destroyThrew;
      return out;
    });
    check('Cytoscape: window.cytoscape is a function', result.typeofCytoscape === 'function', result);
    check('Cytoscape: cytoscape.version === "3.26.0"', result.version === '3.26.0', result);
    check('Cytoscape: real graph has 2 nodes', result.nodeCount === 2, result);
    check('Cytoscape: real graph has 1 edge', result.edgeCount === 1, result);
    check('Cytoscape: destroy() does not throw', result.destroyThrew === false, result);
    check('Cytoscape: no page errors', pageErrors.length === 0, pageErrors);
    await page.close();
  }

  // ── SheetJS xlsx: real library, loaded from dist/runtime/ ──
  {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ path: path.join(RUNTIME_DIR, 'xlsx-0.18.5.full.min.js') });
    const result = await page.evaluate(() => {
      const out = { typeofXLSX: typeof XLSX, version: XLSX.version };
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([['col_a', 'col_b'], ['v1', 'v2']]);
      XLSX.utils.book_append_sheet(wb, ws, 'smoke');
      const bin = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
      out.byteLength = bin.byteLength;
      return out;
    });
    check('XLSX: window.XLSX exists', result.typeofXLSX === 'object' || result.typeofXLSX === 'function', result);
    check('XLSX: XLSX.version === "0.18.5"', result.version === '0.18.5', result);
    check('XLSX: workbook write produced non-empty binary', result.byteLength > 0, result);
    check('XLSX: no page errors', pageErrors.length === 0, pageErrors);
    await page.close();
  }

  // ── TinySegmenter: real library, loaded from dist/runtime/ ──
  {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({ path: path.join(RUNTIME_DIR, 'tiny-segmenter-0.2.0.js') });
    const result = await page.evaluate(() => {
      const out = { typeofTinySegmenter: typeof TinySegmenter };
      let threw = false;
      let tokens = null;
      try {
        const seg = new TinySegmenter();
        tokens = seg.segment('日本語の分かち書きを確認する。');
      } catch (_) { threw = true; }
      out.threw = threw;
      out.isArray = Array.isArray(tokens);
      out.length = Array.isArray(tokens) ? tokens.length : -1;
      return out;
    });
    check('TinySegmenter: constructable (typeof === "function")', result.typeofTinySegmenter === 'function', result);
    check('TinySegmenter: segment() does not throw', result.threw === false, result);
    check('TinySegmenter: segment() returns an array', result.isArray === true, result);
    check('TinySegmenter: known Japanese sentence is not tokenized to an empty array', result.length > 0, result);
    check('TinySegmenter: no page errors', pageErrors.length === 0, pageErrors);
    await page.close();
  }

  // ── Existing character-type-chunk fallback (product code, unmodified): ──
  // block only the tiny-segmenter script from loading (matching the product's
  // own onerror="window.__tsLoadFailed=true" failure path) and confirm the
  // product's own #segmenterStatus element reports the fallback, observed via
  // the completed dist build's actual HTML -- not a new test hook.
  {
    const page = await browser.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    await page.route('**/runtime/tiny-segmenter-0.2.0.js', route => route.abort());
    await page.goto('file://' + DIST_HTML_PATH, { waitUntil: 'load' });
    const statusText = await page.locator('#segmenterStatus').textContent();
    check('Fallback: with TinySegmenter blocked, #segmenterStatus reports the char-type-chunk fallback',
      /文字種チャンク（フォールバック）/.test(statusText || ''), statusText);
    check('Fallback path: no page errors', pageErrors.length === 0, pageErrors);
    await page.close();
  }

  // ── Sanity: with TinySegmenter present (normal dist build), status shows real segmenter. ──
  {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.goto('file://' + DIST_HTML_PATH, { waitUntil: 'load' });
    const statusText = await page.locator('#segmenterStatus').textContent();
    check('Normal path: with TinySegmenter loaded, #segmenterStatus reports "TinySegmenter 使用中"',
      /TinySegmenter 使用中/.test(statusText || ''), statusText);
    check('Normal path: no page errors', pageErrors.length === 0, pageErrors);
    await page.close();
  }

  await browser.close();

  console.log('=== alpha_release_runtime_smoke_verification 結果 ===');
  let passed = 0;
  for (const c of checks) {
    console.log(`[${c.ok ? 'OK' : 'FAIL'}] ${c.name}`);
    if (c.ok) passed += 1;
    else console.log('   detail:', JSON.stringify(c.detail));
  }
  console.log(`\n合計 ${checks.length}件中 ${passed}件成功 / ${checks.length - passed}件失敗`);
  if (passed !== checks.length) process.exitCode = 1;
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});

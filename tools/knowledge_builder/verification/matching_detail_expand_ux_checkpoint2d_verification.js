#!/usr/bin/env node
/* HE-1 Remediation Checkpoint 2-D (Human UX finding, implemented only after Matching Correctness
 * closure): [+]/[-] Detail-table expand control browser regression. Real Chromium, real
 * production tools/json_ab_trace_matching_tool_v12.1.15.html, real button clicks.
 *
 * A. edge count 0 -> no expand control rendered.
 * B. edge count > 0 -> [+] shown, title/aria-label "接続先を展開".
 * C. [+] click -> child edge rows expand, button becomes [-].
 * D. [-] click -> collapse, button becomes [+] again.
 * E. title/aria-label toggle correctly between the two states.
 * F. displayed edge count == expanded row count (count invariant unchanged by the label change).
 *
 * Run: node matching_detail_expand_ux_checkpoint2d_verification.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
let chromium, resolvedExecutablePath;
try { ({ chromium } = require('playwright')); }
catch (_e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
for (const p of [process.env.P2A4_CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium']) {
  if (p && fs.existsSync(p)) { resolvedExecutablePath = p; break; }
}

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const MATCH_TOOL = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const RA01_DIR = path.join(REPO_ROOT, 'tools', 'design_notes', 'runtime_fixtures', 'checkpoint2d_reviewer_RA01');
const CYTOSCAPE_LOCAL = path.join(REPO_ROOT, 'tools', 'release', 'vendor', 'cytoscape-3.26.0', 'cytoscape.min.js');
const XLSX_LOCAL = path.join(REPO_ROOT, 'tools', 'release', 'vendor', 'xlsx-0.18.5', 'xlsx.full.min.js');

let passed = 0, failed = 0;
const failedLabels = [];
function assert(cond, label) {
  if (cond) { passed++; console.log('PASS:', label); }
  else { failed++; failedLabels.push(label); console.log('FAIL:', label); }
}

async function installVendorRoutes(page) {
  await page.route('https://unpkg.com/cytoscape@3.26.0/dist/cytoscape.min.js', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(CYTOSCAPE_LOCAL) }));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(XLSX_LOCAL) }));
  await page.route('https://unpkg.com/tiny-segmenter@0.2.0/dist/tiny-segmenter-0.2.0.js', route => route.abort());
}

(async () => {
  if (!resolvedExecutablePath) { console.log('INCOMPLETE: no working Chromium binary found.'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: resolvedExecutablePath, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await installVendorRoutes(page);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.goto('file://' + MATCH_TOOL);
  await page.waitForTimeout(300);
  await page.setInputFiles('#sysFile', path.join(RA01_DIR, 'RA-01_A_pdf_like.json'));
  await page.setInputFiles('#plmFile', path.join(RA01_DIR, 'RA-01_B_excel_like.json'));
  await page.waitForFunction(() => !document.getElementById('loadBtn').disabled, { timeout: 10000 });
  await page.evaluate(() => document.getElementById('loadBtn').click());
  await page.waitForTimeout(1200);
  await page.click('.tab-btn[data-tab="tabDetail"]');
  await page.waitForTimeout(500);

  // A row with edges (any RA-01 A row has exactly 1 accepted edge to its own code match), and a
  // row with 0 accepted edges (RA-01's A-HU1 self-code has no B-side match at all).
  const rowInfo = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#detailTableBody tr[data-reqid]')];
    const withEdges = rows.find(r => r.querySelector('button[onclick^="toggleDetailRowExpand"]'));
    const withoutEdges = rows.find(r => r.dataset.reqid === 'A-HU1');
    return {
      withEdgesReqId: withEdges ? withEdges.dataset.reqid : null,
      withoutEdgesFound: !!withoutEdges,
      withoutEdgesHasToggle: withoutEdges ? !!withoutEdges.querySelector('button[onclick^="toggleDetailRowExpand"]') : null,
    };
  });
  assert(!!rowInfo.withEdgesReqId, 'setup: at least one Detail row with edges is present');
  assert(rowInfo.withoutEdgesFound, 'setup: the zero-edge row (A-HU1) is present in the Detail table');
  assert(rowInfo.withoutEdgesHasToggle === false, 'A edge count 0 (A-HU1) -> no expand control rendered');

  const reqId = rowInfo.withEdgesReqId;
  const before = await page.evaluate((reqId) => {
    const row = document.querySelector(`#detailTableBody tr[data-reqid="${reqId}"]`);
    const btn = row.querySelector('button[onclick^="toggleDetailRowExpand"]');
    return { text: btn.textContent, title: btn.getAttribute('title'), aria: btn.getAttribute('aria-label') };
  }, reqId);
  assert(before.text === '[+]', `B edge count > 0 -> [+] shown initially (actual: ${JSON.stringify(before.text)})`);
  assert(before.title === '接続先を展開' && before.aria === '接続先を展開', `B title/aria-label is "接続先を展開" before expand (actual: ${JSON.stringify(before)})`);

  // C. click [+] -> expands, becomes [-]
  await page.evaluate((reqId) => {
    document.querySelector(`#detailTableBody tr[data-reqid="${reqId}"] button[onclick^="toggleDetailRowExpand"]`).click();
  }, reqId);
  await page.waitForTimeout(300);
  const afterExpand = await page.evaluate((reqId) => {
    const row = document.querySelector(`#detailTableBody tr[data-reqid="${reqId}"]`);
    const btn = row.querySelector('button[onclick^="toggleDetailRowExpand"]');
    const nodeId = row.dataset.nodeid;
    const expandRows = [...document.querySelectorAll(`#detailTableBody tr.detail-expand-row[data-parent-idx="${row.dataset.idx}"]`)];
    return { text: btn.textContent, title: btn.getAttribute('title'), aria: btn.getAttribute('aria-label'), expandRowCount: expandRows.length };
  }, reqId);
  assert(afterExpand.text === '[-]', `C [+] click -> button becomes [-] (actual: ${JSON.stringify(afterExpand.text)})`);
  assert(afterExpand.expandRowCount === 1, `C [+] click -> exactly 1 child edge row expands (this RA-01 row has exactly 1 accepted edge) (actual: ${afterExpand.expandRowCount})`);
  assert(afterExpand.title === '接続先を閉じる' && afterExpand.aria === '接続先を閉じる', `E title/aria-label toggles to "接続先を閉じる" after expand (actual: ${JSON.stringify(afterExpand)})`);

  // D. click [-] -> collapses, becomes [+] again
  await page.evaluate((reqId) => {
    document.querySelector(`#detailTableBody tr[data-reqid="${reqId}"] button[onclick^="toggleDetailRowExpand"]`).click();
  }, reqId);
  await page.waitForTimeout(300);
  const afterCollapse = await page.evaluate((reqId) => {
    const row = document.querySelector(`#detailTableBody tr[data-reqid="${reqId}"]`);
    const btn = row.querySelector('button[onclick^="toggleDetailRowExpand"]');
    const expandRows = [...document.querySelectorAll(`#detailTableBody tr.detail-expand-row[data-parent-idx="${row.dataset.idx}"]`)];
    return { text: btn.textContent, title: btn.getAttribute('title'), aria: btn.getAttribute('aria-label'), expandRowCount: expandRows.length };
  }, reqId);
  assert(afterCollapse.text === '[+]', `D [-] click -> collapse, button becomes [+] (actual: ${JSON.stringify(afterCollapse.text)})`);
  assert(afterCollapse.expandRowCount === 0, `D [-] click -> child edge rows removed (actual: ${afterCollapse.expandRowCount})`);
  assert(afterCollapse.title === '接続先を展開' && afterCollapse.aria === '接続先を展開', `E title/aria-label toggles back to "接続先を展開" after collapse (actual: ${JSON.stringify(afterCollapse)})`);

  // F. displayed edge count (照合JSON B件数 column) == expanded row count invariant preserved.
  await page.evaluate((reqId) => {
    document.querySelector(`#detailTableBody tr[data-reqid="${reqId}"] button[onclick^="toggleDetailRowExpand"]`).click();
  }, reqId);
  await page.waitForTimeout(300);
  const countCheck = await page.evaluate((reqId) => {
    const row = document.querySelector(`#detailTableBody tr[data-reqid="${reqId}"]`);
    const countCell = [...row.querySelectorAll('td')].find(td => td.dataset.key === '照合JSON B件数');
    const declaredCount = countCell ? parseInt(countCell.textContent, 10) : null;
    const expandRows = [...document.querySelectorAll(`#detailTableBody tr.detail-expand-row[data-parent-idx="${row.dataset.idx}"]`)];
    return { declaredCount, actualExpandRows: expandRows.length };
  }, reqId);
  assert(countCheck.declaredCount === countCheck.actualExpandRows, `F declared 照合JSON B件数 (${countCheck.declaredCount}) equals actual expanded row count (${countCheck.actualExpandRows}) - count invariant unaffected by the label/symbol change`);

  assert(pageErrors.length === 0, `zero page errors during the expand/collapse UX checks (found: ${JSON.stringify(pageErrors)})`);

  await browser.close();
  console.log(`\n${passed} PASS / ${failed} FAIL`);
  if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }
})().catch(e => { console.error('FATAL', e); process.exit(1); });

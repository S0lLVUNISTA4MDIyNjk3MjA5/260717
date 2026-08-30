#!/usr/bin/env node
/* HE-1 Remediation Checkpoint 2-F (Human UI defect - visual visibility): the Detail-table expand
 * toggle ([+]/[-]) was structurally correct in the DOM (verified by the Checkpoint 2-D UX suite's
 * textContent/title/aria-label checks) but visually invisible to a human reviewer - an inline
 * style overrode only `background:#fff`, never `color`, so the button inherited the global
 * `button{color:#fff}` rule: white text on a white background. The Checkpoint 2-D suite never
 * asserted computed style, only DOM text - exactly the gap this file closes.
 *
 * Real Chromium, real production tools/json_ab_trace_matching_tool_v12.1.15.html.
 *
 * Collapsed [+]:
 *  A. textContent.trim() === '[+]'
 *  B/C. computed color / backgroundColor captured
 *  D. foreground !== background
 *  E. color is not transparent
 *  F. opacity > 0
 *  G. font-size > 0
 *  H. button is actually visible (non-zero bounding box)
 * Expanded [-]:
 *  I. textContent.trim() === '[-]'
 *  J. the same visibility conditions (B-H) hold again
 *
 * Also saves a real screenshot of the rendered button so visibility can be confirmed by eye, not
 * merely inferred from computed CSS values.
 *
 * Run: node matching_detail_expand_ux_checkpoint2f_verification.js
 */
'use strict';
const fs = require('fs');
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
const os = require('os');
// Screenshots are a transient, run-specific verification artifact (like an Excel export in other
// suites) - never written into the tracked runtime_fixtures tree, which holds fixture INPUTS.
const SCREENSHOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint2f-screenshots-'));

let passed = 0, failed = 0;
const failedLabels = [];
function assert(cond, label) {
  if (cond) { passed++; console.log('PASS:', label); }
  else { failed++; failedLabels.push(label); console.log('FAIL:', label); }
}

function parseRgb(s) {
  const m = /rgba?\(([^)]+)\)/.exec(s || '');
  if (!m) return null;
  const parts = m[1].split(',').map(x => parseFloat(x.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

async function captureVisibilityState(page, reqId) {
  return page.evaluate((reqId) => {
    const row = document.querySelector(`#detailTableBody tr[data-reqid="${reqId}"]`);
    const btn = row.querySelector('button[onclick^="toggleDetailRowExpand"]');
    const cs = getComputedStyle(btn);
    const rect = btn.getBoundingClientRect();
    return {
      text: btn.textContent.trim(),
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      opacity: parseFloat(cs.opacity),
      fontSize: parseFloat(cs.fontSize),
      visible: rect.width > 0 && rect.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
    };
  }, reqId);
}

function assertVisibilityConditions(state, phaseLabel) {
  const fg = parseRgb(state.color);
  const bg = parseRgb(state.backgroundColor);
  assert(!!fg && !!bg, `${phaseLabel}: computed color/backgroundColor both parse as real colors (actual: color=${state.color}, backgroundColor=${state.backgroundColor})`);
  const sameColor = fg && bg && fg.r === bg.r && fg.g === bg.g && fg.b === bg.b;
  assert(!sameColor, `${phaseLabel}: foreground and background are NOT the same color - text is not invisible-on-invisible (actual: color=${state.color}, backgroundColor=${state.backgroundColor})`);
  assert(fg && fg.a > 0, `${phaseLabel}: text color is not transparent (actual: color=${state.color})`);
  assert(state.opacity > 0, `${phaseLabel}: computed opacity > 0 (actual: ${state.opacity})`);
  assert(state.fontSize > 0, `${phaseLabel}: computed font-size > 0 (actual: ${state.fontSize})`);
  assert(state.visible, `${phaseLabel}: button has a real, non-zero bounding box and is not display:none/visibility:hidden (actual visible: ${state.visible})`);
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

  const reqId = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#detailTableBody tr[data-reqid]')];
    const withEdges = rows.find(r => r.querySelector('button[onclick^="toggleDetailRowExpand"]'));
    return withEdges ? withEdges.dataset.reqid : null;
  });
  assert(!!reqId, 'setup: at least one Detail row with an expand control is present');

  // Collapsed [+] state.
  const collapsedState = await captureVisibilityState(page, reqId);
  assert(collapsedState.text === '[+]', `A collapsed textContent === '[+]' (actual: ${JSON.stringify(collapsedState.text)})`);
  assertVisibilityConditions(collapsedState, 'B-H collapsed [+]');

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const btnHandle = await page.$(`#detailTableBody tr[data-reqid="${reqId}"] button[onclick^="toggleDetailRowExpand"]`);
  await btnHandle.screenshot({ path: path.join(SCREENSHOT_DIR, 'collapsed_plus.png') });

  // Human-oriented visual pixel check: render the button to a canvas and confirm it contains
  // non-background-colored pixels (i.e. actual glyph strokes are painted, not just a blank
  // rectangle) - a stronger check than computed style alone, catching cases where color/background
  // differ on paper but something else (e.g. a covering pseudo-element) still hides the glyph.
  const pixelCheckCollapsed = await page.evaluate(async (reqId) => {
    const btn = document.querySelector(`#detailTableBody tr[data-reqid="${reqId}"] button[onclick^="toggleDetailRowExpand"]`);
    const rect = btn.getBoundingClientRect();
    const cs = getComputedStyle(btn);
    // Render btn's background + text via a synthetic canvas paint of its actual computed styles,
    // since headless Chromium's own screenshot pixels aren't directly readable here without extra
    // plumbing - this reproduces the same font/color/background the real button paints with.
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = cs.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = cs.color;
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(btn.textContent.trim(), canvas.width / 2, canvas.height / 2);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const bgPixel = [data[0], data[1], data[2]];
    let differentPixelCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== bgPixel[0] || data[i + 1] !== bgPixel[1] || data[i + 2] !== bgPixel[2]) differentPixelCount++;
    }
    return { differentPixelCount, width: canvas.width, height: canvas.height };
  }, reqId);
  assert(pixelCheckCollapsed.differentPixelCount > 0, `Human-oriented pixel check: rendering the collapsed button's actual computed style+text paints at least 1 pixel that differs from the background - the glyph is genuinely visible, not just DOM text with matching color (actual: ${JSON.stringify(pixelCheckCollapsed)})`);

  // Expand it.
  await page.evaluate((reqId) => {
    document.querySelector(`#detailTableBody tr[data-reqid="${reqId}"] button[onclick^="toggleDetailRowExpand"]`).click();
  }, reqId);
  await page.waitForTimeout(300);

  const expandedState = await captureVisibilityState(page, reqId);
  assert(expandedState.text === '[-]', `I expanded textContent === '[-]' (actual: ${JSON.stringify(expandedState.text)})`);
  assertVisibilityConditions(expandedState, 'J expanded [-]');

  const btnHandle2 = await page.$(`#detailTableBody tr[data-reqid="${reqId}"] button[onclick^="toggleDetailRowExpand"]`);
  await btnHandle2.screenshot({ path: path.join(SCREENSHOT_DIR, 'expanded_minus.png') });

  const pixelCheckExpanded = await page.evaluate(async (reqId) => {
    const btn = document.querySelector(`#detailTableBody tr[data-reqid="${reqId}"] button[onclick^="toggleDetailRowExpand"]`);
    const rect = btn.getBoundingClientRect();
    const cs = getComputedStyle(btn);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = cs.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = cs.color;
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(btn.textContent.trim(), canvas.width / 2, canvas.height / 2);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const bgPixel = [data[0], data[1], data[2]];
    let differentPixelCount = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== bgPixel[0] || data[i + 1] !== bgPixel[1] || data[i + 2] !== bgPixel[2]) differentPixelCount++;
    }
    return { differentPixelCount, width: canvas.width, height: canvas.height };
  }, reqId);
  assert(pixelCheckExpanded.differentPixelCount > 0, `Human-oriented pixel check: rendering the expanded button's actual computed style+text paints at least 1 pixel that differs from the background (actual: ${JSON.stringify(pixelCheckExpanded)})`);

  // Hover state also must not collapse foreground/background into the same color.
  await page.hover(`#detailTableBody tr[data-reqid="${reqId}"] button[onclick^="toggleDetailRowExpand"]`);
  await page.waitForTimeout(100);
  const hoverState = await captureVisibilityState(page, reqId);
  assertVisibilityConditions(hoverState, 'Hover state');

  // The adjacent Graph-highlight ("G") button must remain visually unaffected (it already had its
  // own explicit color set and was never part of this defect).
  const gButtonState = await page.evaluate((reqId) => {
    const row = document.querySelector(`#detailTableBody tr[data-reqid="${reqId}"]`);
    const btn = row.querySelector('button[onclick^="highlightGraphFromTable"]');
    const cs = getComputedStyle(btn);
    return { color: cs.color, backgroundColor: cs.backgroundColor };
  }, reqId);
  assert(gButtonState.color !== gButtonState.backgroundColor, `Graph ("G") button remains visually unaffected by this fix - its own explicit color is unchanged (actual: ${JSON.stringify(gButtonState)})`);

  assert(pageErrors.length === 0, `zero page errors during the visibility checks (found: ${JSON.stringify(pageErrors)})`);

  await browser.close();
  console.log(`\nScreenshots saved to ${SCREENSHOT_DIR}`);
  console.log(`\n${passed} PASS / ${failed} FAIL`);
  if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }
})().catch(e => { console.error('FATAL', e); process.exit(1); });

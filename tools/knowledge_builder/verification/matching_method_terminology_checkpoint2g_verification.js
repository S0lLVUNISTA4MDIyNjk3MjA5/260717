#!/usr/bin/env node
/* HE-1 Remediation Checkpoint 2-G: browser regression for the Japanese Method Labels terminology
 * unification. Confirms, in real Chromium against real fixtures (the Checkpoint 2-G reviewer
 * sample set for exact/partial/code/fuzzy/vector/tag/hier), that the raw English method enum is
 * NEVER shown alone on the primary Human-facing expanded-edge surface (the Detail table's expand
 * row rendered by renderDetailExpandRow()) - it always appears as "日本語 (英語enum)" - while the
 * underlying Excel-facing raw method value stays completely untouched (byte-identical enum, no
 * Japanese wrapping), confirming the presentation/data split documented in the Checkpoint 2-G
 * design note.
 *
 * Run: node matching_method_terminology_checkpoint2g_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
let CHROMIUM_PATH;
for (const p of [process.env.P2A4_CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium']) {
  if (p && fs.existsSync(p)) { CHROMIUM_PATH = p; break; }
}
const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HTML_PATH = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const SAMPLES_DIR = path.join(REPO_ROOT, 'tools', 'design_notes', 'runtime_fixtures', 'checkpoint2g_reviewer_matching_methods');

let passed = 0, failed = 0;
const failedLabels = [];
function assert(cond, label) {
  if (cond) { passed++; console.log('PASS:', label); }
  else { failed++; failedLabels.push(label); console.log('FAIL:', label); }
}

async function newPage(browser) {
  const page = await browser.newPage();
  await page.route('https://unpkg.com/tiny-segmenter@0.2.0/dist/tiny-segmenter-0.2.0.js', route => route.abort());
  await page.goto('file://' + HTML_PATH, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(300);
  return page;
}
async function loadFixture(page, dir, aName = 'A.json', bName = 'B.json') {
  await page.setInputFiles('#sysFile', path.join(dir, aName));
  await page.setInputFiles('#plmFile', path.join(dir, bName));
  await page.click('#loadBtn');
  await page.waitForTimeout(1200);
}
async function setKeyPairsAndRerun(page, pairs) {
  await page.evaluate((pairs) => { matchLogic.keyPairs = pairs; invalidateMatchCache(); }, pairs);
  await page.evaluate(() => document.getElementById('rerunMatchBtn').click());
  await page.waitForTimeout(1000);
}

// Expand the first Detail row that has edges and read back the rendered expand row's text.
async function firstExpandRowText(page) {
  await page.evaluate(() => { const b = document.querySelector('[data-tab="tabDetail"]'); if (b) b.click(); });
  await page.waitForTimeout(600);
  const nodeId = await page.evaluate(() => {
    if (typeof renderDetailTableFull === 'function') renderDetailTableFull();
    const rows = typeof detailRows !== 'undefined' ? detailRows : [];
    const row = rows.find(r => Array.isArray(r._edgeRows) && r._edgeRows.length);
    return row ? row._nodeId : null;
  });
  if (!nodeId) return null;
  await page.evaluate((id) => toggleDetailRowExpand(id), nodeId);
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const cell = document.querySelector('tr.detail-expand-row td.detail-expand-cell');
    return cell ? cell.textContent : null;
  });
}

// Direct-value check via matchingMethodDisplayLabel() itself, independent of DOM rendering -
// confirms the mapping table entry for a given raw enum, and that it is never the bare enum alone.
async function labelFor(page, method) {
  return page.evaluate((m) => matchingMethodDisplayLabel(m), method);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });

  // A. Direct mapping-table checks for all 11 defined methods: label != raw method, label contains
  // "(method)" verbatim, and an unknown future value falls back to itself unchanged (never throws).
  {
    const page = await newPage(browser);
    const REQUIRED = {
      exact: '完全一致 (exact)', partial: '部分一致 (partial)', code: 'コード一致 (code)',
      model: 'モデル名一致 (model)', synonym: '同義語一致 (synonym)', 'auto-synonym': '自動同義語一致 (auto-synonym)',
      fuzzy: '類似一致 (fuzzy)', vector: 'ベクトル類似 (vector)', tag: 'タグ一致 (tag)',
      hier: '階層判定 (hier)', none: '一致なし (none)',
    };
    for (const [method, expected] of Object.entries(REQUIRED)) {
      const label = await labelFor(page, method);
      assert(label === expected, `A[${method}] matchingMethodDisplayLabel('${method}') === '${expected}' (got '${label}')`);
      assert(label !== method, `A[${method}] display label is never the bare raw enum alone`);
    }
    const fallback = await labelFor(page, 'future-unknown-method-2027');
    assert(fallback === 'future-unknown-method-2027', 'A[fallback] an unmapped future method value returns itself unchanged (never throws, never blank)');
    await page.close();
  }

  // B. Real-Chromium Detail-table expand-row surface: for each of exact/partial/code/fuzzy/vector/
  // tag/hier, using the actual Checkpoint 2-G validated sample fixtures, the rendered expand row
  // text includes the Japanese(enum) label - never the bare raw enum as a standalone token.
  const CASES = [
    { name: 'exact', dir: '01_EXACT', pairs: [{ enabled: true, sysField: 'match_name', plmField: 'match_name', method: 'exact' }], label: '完全一致 (exact)' },
    { name: 'partial', dir: '02_PARTIAL', pairs: [{ enabled: true, sysField: 'match_text', plmField: 'match_text', method: 'contains' }], label: '部分一致 (partial)' },
    { name: 'code', dir: '03_CODE', pairs: [{ enabled: true, sysField: 'code_and_name', plmField: 'code_and_name', method: 'code' }], label: 'コード一致 (code)' },
    { name: 'fuzzy', dir: '06_FUZZY', pairs: [{ enabled: true, sysField: 'fuzzy_text', plmField: 'fuzzy_text', method: 'fuzzy' }], label: '類似一致 (fuzzy)' },
    { name: 'vector', dir: '07_VECTOR', pairs: [{ enabled: true, sysField: 'vector_text', plmField: 'vector_text', method: 'vector' }], label: 'ベクトル類似 (vector)' },
    { name: 'hier', dir: '09_HIERARCHY', pairs: [{ enabled: true, sysField: 'match_text', plmField: 'match_text', method: 'contains' }], label: ['完全一致 (exact)', '階層判定 (hier)'] },
  ];
  for (const c of CASES) {
    const page = await newPage(browser);
    await loadFixture(page, path.join(SAMPLES_DIR, c.dir));
    await setKeyPairsAndRerun(page, c.pairs);
    const text = await firstExpandRowText(page);
    assert(text != null, `B[${c.name}] Detail table produced at least one expandable edge row`);
    const labels = Array.isArray(c.label) ? c.label : [c.label];
    assert(labels.some(l => text && text.includes(l)), `B[${c.name}] expand row text includes the Japanese(enum) label (got: ${JSON.stringify(text)})`);
    // The bare raw enum must never appear as a standalone "method: <enum>" or "(method):" token
    // without the Japanese label attached - i.e. it is always inside the "日本語 (enum)" wrapper.
    const bareLeak = text && new RegExp(`(?<!\\(|一致 |類似 |判定 )\\b${c.name}\\b(?!\\))`).test(text.replace(new RegExp(labels.join('|'), 'g'), ''));
    assert(!bareLeak, `B[${c.name}] raw enum does not leak as a standalone token outside the Japanese(enum) wrapper`);
    await page.close();
  }

  // C. TAG method (needs tag-matching settings, not a key-pair method) - 08_TAG.
  {
    const page = await newPage(browser);
    await loadFixture(page, path.join(SAMPLES_DIR, '08_TAG'));
    await page.evaluate(() => {
      matchLogic.keyPairs = [];
      matchLogic.tagSettings.enabled = true;
      matchLogic.tagSettings.useForMatching = true;
      invalidateMatchCache();
    });
    await page.evaluate(() => document.getElementById('rerunMatchBtn').click());
    await page.waitForTimeout(1000);
    const text = await firstExpandRowText(page);
    assert(text != null, 'C[tag] Detail table produced at least one expandable edge row');
    assert(text && text.includes('タグ一致 (tag)'), `C[tag] expand row text includes the Japanese(enum) label (got: ${JSON.stringify(text)})`);
    assert(text && !text.includes('辞書・タグ一致') && !text.includes('辞書一致'),
      'C[tag] never shows a dictionary-flavored label for tag (tag can originate from explicit row tags, not only Approved Dictionary)');
    await page.close();
  }

  // D. Excel machine-contract preservation: the raw 照合根拠 column value stays the bare enum
  // prefix (never Japanese-wrapped) even though the same edge's on-screen expand row IS wrapped.
  {
    const page = await newPage(browser);
    await loadFixture(page, path.join(SAMPLES_DIR, '01_EXACT'));
    await setKeyPairsAndRerun(page, [{ enabled: true, sysField: 'match_name', plmField: 'match_name', method: 'exact' }]);
    const raw = await page.evaluate(() => {
      const rows = buildDetailRows(mergedResult.sysList, mergedResult.plmList);
      const withEvidence = rows.find(r => r['照合根拠']);
      return withEvidence ? withEvidence['照合根拠'] : null;
    });
    assert(raw != null, 'D setup: at least one Detail row has a 照合根拠 value');
    assert(raw && /^exact: /.test(raw), `D the raw 照合根拠 value fed to Excel export starts with the bare enum "exact: " (got: ${JSON.stringify(raw)})`);
    assert(raw && !raw.includes('完全一致'), 'D the raw Excel-facing value is never Japanese-wrapped');
    await page.close();
  }

  // E. Static help/legend table and key-pair selector dropdown both show Japanese(enum), never
  // the bare raw enum alone.
  {
    const page = await newPage(browser);
    const helpRows = await page.evaluate(() => {
      const table = Array.from(document.querySelectorAll('details table')).find(t => t.querySelector('th') && /方式/.test(t.querySelector('th').textContent));
      if (!table) return [];
      return Array.from(table.querySelectorAll('tbody tr td:first-child')).map(td => td.textContent);
    });
    assert(helpRows.length >= 9, `E static help table has all method rows (got ${helpRows.length})`);
    assert(helpRows.every(t => /\([a-z-]+\)/.test(t)), 'E every static help table method cell includes the (enum) suffix');
    const selectorLabels = await page.evaluate(() => KEY_MATCH_METHODS.map(m => m.label));
    assert(selectorLabels.every(l => /\([a-z]+\)/.test(l)), 'E every key-pair selector dropdown label includes the (enum) suffix');
    assert(selectorLabels.some(l => l.startsWith('包含一致')), 'E the "contains" configuration mode keeps its own distinct label (never silently renamed to exact/partial)');
    await page.close();
  }

  await browser.close();
  console.log(`\n${passed} PASS / ${failed} FAIL`);
  if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }
})().catch(e => { console.error('FATAL', e); process.exit(1); });

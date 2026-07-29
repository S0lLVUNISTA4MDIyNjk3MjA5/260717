#!/usr/bin/env node
'use strict';
/*
 * v0.10.1-alpha Checkpoint 5: version/metadata harmonization verification.
 *
 * Scope: confirm PDF and Excel tools both present as v0.10.1-alpha in every
 * user-visible/current-facing location (title, alpha-meta banner,
 * ALPHA_TOOL_VERSION -> alpha_meta.tool_version in the downloaded
 * .alpha_eval.json envelope), that no forbidden old-version strings
 * (0.1.0-alpha / 0.8.0-alpha / 0.10.0-alpha) remain in those locations, and
 * that compatibility identifiers (ALPHA_BASE_TOOL, generator.version) which
 * intentionally still point at the historical base-tool files are UNCHANGED.
 * Then re-runs the prior checkpoints' verification scripts as a regression
 * check, since this checkpoint only edits strings inside files those scripts
 * already exercise.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = __dirname;
const PDF_TOOL_DIR = path.join(ROOT, 'pdf_tool');
const PDF_HTML = path.join(PDF_TOOL_DIR, 'spec_to_json_conversion_tool_alpha_v0.10.1.html');
const PDF_SAMPLE = path.join(PDF_TOOL_DIR, 'samples', 'sample_input.pdf');
const EXCEL_TOOL_DIR = path.join(ROOT, 'excel_tool');
const EXCEL_HTML = path.join(EXCEL_TOOL_DIR, 'excel_to_json_conversion_tool_alpha_v0.10.1.html');
const EXCEL_SAMPLE = path.join(EXCEL_TOOL_DIR, 'samples', 'sample_input.xlsx');

const FORBIDDEN = ['0.1.0-alpha', '0.8.0-alpha', '0.10.0-alpha'];
const EXPECTED_VERSION = '0.10.1-alpha';

const checks = [];
function check(name, cond, detail) { checks.push({ name, ok: !!cond, detail }); }

function readText(p) { return fs.readFileSync(p, 'utf8'); }

// ── Static, current-facing-only forbidden-string scan ──────────────────────
// Deliberately scoped to the specific lines/fields the checkpoint targets
// (title/banner/ALPHA_TOOL_VERSION, KNOWN_LIMITATIONS/README titles), not a
// whole-tree grep -- historical comments and pre-existing golden sample
// fixtures are explicitly out of scope for this checkpoint (see report).
function staticChecks() {
  const pdfHtml = readText(PDF_HTML);
  const excelHtml = readText(EXCEL_HTML);

  const pdfTitleLine = pdfHtml.match(/<title>.*<\/title>/)[0];
  const excelTitleLine = excelHtml.match(/<title>.*<\/title>/)[0];
  const pdfBannerLine = pdfHtml.match(/<span class="alpha-meta">仕様書PDF[^<]*<\/span>/)[0];
  const excelBannerLine = excelHtml.match(/<span class="alpha-meta">Excel[^<]*<\/span>/)[0];
  const pdfToolVersionLine = pdfHtml.match(/const ALPHA_TOOL_VERSION = "[^"]*";/)[0];
  const excelToolVersionLine = excelHtml.match(/const ALPHA_TOOL_VERSION = '[^']*';/)[0];

  for (const [label, line] of [
    ['PDF <title>', pdfTitleLine], ['Excel <title>', excelTitleLine],
    ['PDF alpha-meta banner', pdfBannerLine], ['Excel alpha-meta banner', excelBannerLine],
    ['PDF ALPHA_TOOL_VERSION', pdfToolVersionLine], ['Excel ALPHA_TOOL_VERSION', excelToolVersionLine],
  ]) {
    check(`${label} は ${EXPECTED_VERSION} を含む`, line.includes(EXPECTED_VERSION), line);
    for (const bad of FORBIDDEN) {
      check(`${label} に禁止文字列 "${bad}" が無い`, !line.includes(bad), line);
    }
  }

  // Compatibility identifiers: must remain pointing at the real historical
  // base-tool files/build markers, NOT be swept up by version harmonization.
  check('PDF ALPHA_BASE_TOOL は母体ファイル名のまま(互換性識別子)',
    pdfHtml.includes('const ALPHA_BASE_TOOL = "spec_to_json_conversion_tool_v1.18.html";'));
  check('Excel ALPHA_BASE_TOOL は母体ファイル名のまま(互換性識別子)',
    excelHtml.includes("const ALPHA_BASE_TOOL = 'excel_to_json_conversion_tool_v2.0.8.html';"));
  check('Excel generator.version は基準ツール版数のまま(互換性識別子)',
    excelHtml.includes("generator: { name: 'Excel → JSON 変換・確認ツール', version: '2.0.8' }"));

  // Distribution filenames / directory name.
  check('PDF HTMLファイル名は alpha_v0.10.1', fs.existsSync(PDF_HTML));
  check('Excel HTMLファイル名は alpha_v0.10.1', fs.existsSync(EXCEL_HTML));
  check('配布ディレクトリ名は v0.10.1', path.basename(ROOT) === 'pdf_excel_json_tools_alpha_v0.10.1_ai_review_handoff');

  // README / KNOWN_LIMITATIONS: must exist and title-carry the current version.
  const README = path.join(ROOT, 'README.md');
  const PDF_KL = path.join(PDF_TOOL_DIR, 'KNOWN_LIMITATIONS.md');
  const EXCEL_KL = path.join(EXCEL_TOOL_DIR, 'KNOWN_LIMITATIONS.md');
  // README.md's own established title convention (matching the v0.10.0
  // baseline) omits the "-alpha" suffix in the heading itself ("v0.10.0",
  // not "v0.10.0-alpha" -- "α版" already appears in the same line), unlike
  // the HTML tools' <title>/banner and the KNOWN_LIMITATIONS.md headings,
  // which do carry the "-alpha" suffix.
  for (const [label, p, versionToken] of [
    ['README.md', README, '0.10.1'],
    ['pdf_tool/KNOWN_LIMITATIONS.md', PDF_KL, EXPECTED_VERSION],
    ['excel_tool/KNOWN_LIMITATIONS.md', EXCEL_KL, EXPECTED_VERSION],
  ]) {
    const exists = fs.existsSync(p);
    check(`${label} が存在する`, exists);
    if (exists) {
      const head = readText(p).split('\n')[0];
      check(`${label} の見出しが ${versionToken} を含む`, head.includes(versionToken), head);
      for (const bad of FORBIDDEN) check(`${label} 見出しに禁止文字列 "${bad}" が無い`, !head.includes(bad), head);
    }
  }
}

// ── Real-browser checks: title, banner, and the actual downloaded
//    .alpha_eval.json envelope (the only place ALPHA_TOOL_VERSION reaches
//    user-visible output for Excel, whose script is IIFE-wrapped) ─────────
async function browserChecks() {
  const pageErrors = [];
  const consoleErrors = [];
  const browser = await chromium.launch();
  const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cp5-'));
  try {
    // PDF: works even without a converted document (alphaBuildEnvelope
    // tolerates data === null), so no sample load is required here.
    const pdfPage = await browser.newPage();
    pdfPage.on('pageerror', e => pageErrors.push('PDF: ' + e.message));
    pdfPage.on('console', m => { if (m.type() === 'error') consoleErrors.push('PDF: ' + m.text()); });
    await pdfPage.goto('file://' + PDF_HTML, { waitUntil: 'load' });

    const pdfTitle = await pdfPage.title();
    check('PDF 実ページの document.title が v0.10.1-alpha', pdfTitle.includes(EXPECTED_VERSION), pdfTitle);
    // .alpha-banner .alpha-meta is display:none under body.minimal-ui (the
    // default simple-wizard mode), so read textContent directly via
    // evaluate rather than an actionable-locator innerText() (which would
    // wait on visibility that never arrives).
    const pdfBanner = await pdfPage.evaluate(() => document.querySelector('.alpha-meta').textContent);
    check('PDF 実ページの alpha-meta バナーが v0.10.1-alpha', pdfBanner.includes(EXPECTED_VERSION), pdfBanner);

    const [pdfDownload] = await Promise.all([
      pdfPage.waitForEvent('download', { timeout: 15000 }),
      pdfPage.evaluate(() => document.getElementById('alphaDownloadBtn').click()),
    ]);
    const pdfEnvelopePath = path.join(tempDir, 'pdf.alpha_eval.json');
    await pdfDownload.saveAs(pdfEnvelopePath);
    const pdfEnvelope = JSON.parse(fs.readFileSync(pdfEnvelopePath, 'utf8'));
    check('PDF 実ダウンロード envelope の alpha_meta.tool_version が v0.10.1-alpha',
      pdfEnvelope.alpha_meta.tool_version === EXPECTED_VERSION, pdfEnvelope.alpha_meta.tool_version);
    check('PDF 実ダウンロード envelope の alpha_meta.base_tool は母体ファイル名のまま(互換性識別子)',
      pdfEnvelope.alpha_meta.base_tool === 'spec_to_json_conversion_tool_v1.18.html', pdfEnvelope.alpha_meta.base_tool);
    await pdfPage.close();

    // Excel: alphaDownloadEnvelope() no-ops unless alphaHasOutput() is true,
    // so a real conversion must happen first.
    const excelPage = await browser.newPage();
    excelPage.on('pageerror', e => pageErrors.push('Excel: ' + e.message));
    excelPage.on('console', m => { if (m.type() === 'error') consoleErrors.push('Excel: ' + m.text()); });
    await excelPage.goto('file://' + EXCEL_HTML, { waitUntil: 'load' });

    const excelTitle = await excelPage.title();
    check('Excel 実ページの document.title が v0.10.1-alpha', excelTitle.includes(EXPECTED_VERSION), excelTitle);
    const excelBanner = await excelPage.evaluate(() => document.querySelector('.alpha-meta').textContent);
    check('Excel 実ページの alpha-meta バナーが v0.10.1-alpha', excelBanner.includes(EXPECTED_VERSION), excelBanner);

    await excelPage.setInputFiles('#excelFile', EXCEL_SAMPLE);
    await excelPage.waitForFunction(() => document.getElementById('simpleConvert').disabled === false, null, { timeout: 15000 });
    await excelPage.click('#simpleConvert');
    await excelPage.waitForFunction(() => document.getElementById('downloadJsonBtn').disabled === false, null, { timeout: 15000 });

    const [excelDownload] = await Promise.all([
      excelPage.waitForEvent('download', { timeout: 15000 }),
      excelPage.evaluate(() => document.getElementById('alphaDownloadBtn').click()),
    ]);
    const excelEnvelopePath = path.join(tempDir, 'excel.alpha_eval.json');
    await excelDownload.saveAs(excelEnvelopePath);
    const excelEnvelope = JSON.parse(fs.readFileSync(excelEnvelopePath, 'utf8'));
    check('Excel 実ダウンロード envelope の alpha_meta.tool_version が v0.10.1-alpha',
      excelEnvelope.alpha_meta.tool_version === EXPECTED_VERSION, excelEnvelope.alpha_meta.tool_version);
    check('Excel 実ダウンロード envelope の alpha_meta.base_tool は母体ファイル名のまま(互換性識別子)',
      excelEnvelope.alpha_meta.base_tool === 'excel_to_json_conversion_tool_v2.0.8.html', excelEnvelope.alpha_meta.base_tool);
    await excelPage.close();
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  check('ページエラーが0件', pageErrors.length === 0, pageErrors.join('; '));
  check('コンソールエラーが0件', consoleErrors.length === 0, consoleErrors.join('; '));
}

// ── Regression: re-run every prior checkpoint's own verification script.
//    This checkpoint only edits version-identifying string literals inside
//    files those scripts already load, so a clean re-run is the correct
//    proof of no regression (not a re-derivation of their own logic here).
function runRegressionSuites() {
  const suites = [
    'pdf_checkpoint1_verification.js',
    'excel_checkpoint2_verification.js',
    'excel_checkpoint3_verification.js',
    'shared_tag_vocabulary_verification.js',
  ];
  for (const suite of suites) {
    const suitePath = path.join(ROOT, suite);
    let output = '';
    let ok = false;
    try {
      output = execFileSync('node', [suitePath], { cwd: ROOT, timeout: 180000, encoding: 'utf8' });
      ok = true;
    } catch (e) {
      output = (e.stdout || '') + (e.stderr || '');
      ok = false;
    }
    const m = output.match(/合計\s*(\d+)件中\s*(\d+)件成功/);
    if (ok && m && m[1] === m[2]) {
      check(`回帰: ${suite} が全件成功`, true, `${m[2]}/${m[1]}`);
    } else {
      check(`回帰: ${suite} が全件成功`, false, m ? `${m[2]}/${m[1]}` : output.slice(-800));
    }
  }
}

function report() {
  const total = checks.length;
  const passed = checks.filter(c => c.ok).length;
  console.log('=== Checkpoint 5 (版数・メタデータ統一) 検証結果 ===');
  for (const c of checks) {
    console.log(`[${c.ok ? 'PASS' : 'FAIL'}] ${c.name}${c.detail !== undefined ? ` :: ${c.detail}` : ''}`);
  }
  console.log(`\n合計 ${total}件中 ${passed}件成功`);
  if (passed !== total) process.exitCode = 1;
}

async function main() {
  staticChecks();
  await browserChecks();
  runRegressionSuites();
  report();
}

main().catch(e => { console.error(e); process.exitCode = 1; });

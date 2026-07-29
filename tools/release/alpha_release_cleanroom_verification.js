#!/usr/bin/env node
'use strict';
/*
 * Alpha Release Gate 1 - Checkpoint 3C: clean-room verification.
 *
 * Copies ONLY the completed dist/ output (never .git, node_modules, the repo
 * tree, tools/design_notes, tools/release/vendor, or the fixtures directory)
 * into isolated temp locations -- one with a space in the path, one with
 * Japanese characters -- and drives startup + basic match + official
 * JSON/Excel save from each copy in total isolation. Test input fixtures are
 * themselves copied into a separate temp input directory first; the product
 * under test never reads from the original tools/design_notes/runtime_fixtures
 * directory at runtime.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DIST_SOURCE_DIR = path.join(REPO_ROOT, 'dist', 'trace-matching-tool-v12.2.0-alpha.1');
const HTML_NAME = 'json_ab_trace_matching_tool_v12.2.0-alpha.1.html';
const REQUIREMENT_FIXTURE_PATH = path.join(REPO_ROOT, 'tools', 'design_notes', 'runtime_fixtures', 'quantity_annotation_pdf_verified.json');
const ACTUAL_FIXTURE_PATH = path.join(REPO_ROOT, 'tools', 'design_notes', 'runtime_fixtures', 'quantity_annotation_excel_verified.json');

const CLEANROOM_TARGETS = [
  { label: 'space-in-path', dirName: 'Alpha Release Test 01' },
  { label: 'japanese-path', dirName: '照合ツール α版' },
];

const checks = [];
function check(name, condition, detail) { checks.push({ name, ok: !!condition, detail }); }
function loadJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function copyDirExcluding(src, dest, excludeNames) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (excludeNames.includes(name)) continue;
    const s = path.join(src, name);
    const d = path.join(dest, name);
    const stat = fs.lstatSync(s);
    if (stat.isDirectory()) copyDirExcluding(s, d, []);
    else fs.copyFileSync(s, d);
  }
}

async function waitForMatchingIdle(page) {
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 30000 });
}
async function waitOverlayStatus(page, targetPath, expectedStatus) {
  await page.waitForFunction(([p, expected]) => {
    if (activeMatchingJob !== null) return false;
    const cache = window.__b4bCheckpoint2Diagnostics.projectionCache();
    const id = document.getElementById('b4bComparisonPanelTitle')?.textContent.split(': ')[1];
    if (cache.status === 'unavailable' || !id) return false;
    const entry = cache.projected.result.comparisons[id];
    const value = p.split('.').reduce((acc, key) => acc?.[key], entry);
    return value === expected;
  }, [targetPath, expectedStatus], { timeout: 20000 });
}
async function clickReviewAction(page, selector, targetPath, expectedStatus) {
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 20000 });
  await page.click(selector);
  await waitOverlayStatus(page, targetPath, expectedStatus);
}

async function runOneCleanroomTarget(target, inputFiles) {
  const cleanroomBase = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-cleanroom-'));
  const targetDir = path.join(cleanroomBase, target.dirName);
  copyDirExcluding(DIST_SOURCE_DIR, targetDir, []);
  const htmlPath = path.join(targetDir, HTML_NAME);
  check(`[${target.label}] dist一式をclean-roomへコピー完了`, fs.existsSync(htmlPath), htmlPath);
  check(`[${target.label}] コピー先パスに.gitが含まれない`, !fs.existsSync(path.join(targetDir, '.git')));
  check(`[${target.label}] コピー先パスにnode_modulesが含まれない`, !fs.existsSync(path.join(targetDir, 'node_modules')));

  const browser = await chromium.launch();
  let scenarioError = null;
  try {
    const context = await browser.newContext();
    const externalAttempts = [];
    const allRequestUrls = [];
    await context.route('**/*', route => {
      const url = route.request().url();
      allRequestUrls.push(url);
      if (!url.startsWith('file://')) { externalAttempts.push(url); route.abort(); return; }
      route.continue();
    });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('dialog', d => d.accept());

    await page.goto('file://' + htmlPath, { waitUntil: 'load' });

    const startup = await page.evaluate(() => ({
      title: document.title,
      h1: document.querySelector('body > h1')?.textContent,
      cytoscapeVersion: typeof window.cytoscape !== 'undefined' ? window.cytoscape.version : null,
      xlsxVersion: typeof window.XLSX !== 'undefined' ? window.XLSX.version : null,
    }));
    check(`[${target.label}] file://で起動し document.title がV12.2.0-alpha.1`, startup.title === 'JSON A/B トレース照合ツール V12.2.0-alpha.1', startup);
    check(`[${target.label}] h1がV12.2.0-alpha.1`, startup.h1 === 'JSON A/B トレース照合ツール V12.2.0-alpha.1', startup);
    check(`[${target.label}] Cytoscape実ライブラリがロードされている(version 3.26.0)`, startup.cytoscapeVersion === '3.26.0', startup);
    check(`[${target.label}] XLSX実ライブラリがロードされている(version 0.18.5)`, startup.xlsxVersion === '0.18.5', startup);

    await page.setInputFiles('#sysFile', inputFiles.requirementTrace);
    await page.setInputFiles('#plmFile', inputFiles.actualTrace);
    await page.setInputFiles('#sysQuantityFile', inputFiles.requirementSidecar);
    await page.setInputFiles('#plmQuantityFile', inputFiles.actualSidecar);
    await page.click('#loadBtn');
    await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('完了'), null, { timeout: 30000 });
    await waitForMatchingIdle(page);
    await page.evaluate(() => {
      matchLogic.keyPairs = [{ enabled: true, sysField: 'trace_text', plmField: 'trace_text', method: 'fuzzy' }];
      matchLogic.fuzzyThreshold = 0;
      matchLogic.minConfidence = 0.7;
      invalidateMatchCache();
    });
    await page.click('#rerunMatchBtn');
    await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('再照合が完了'), null, { timeout: 30000 });
    await waitForMatchingIdle(page);
    await page.waitForTimeout(200);

    const matchInfo = await page.evaluate(() => ({ sysCount: mergedResult?.sysList?.length, plmCount: mergedResult?.plmList?.length }));
    check(`[${target.label}] 基本照合: JSON A/B読込み・件数が期待どおり(5/4)`, matchInfo.sysCount === 5 && matchInfo.plmCount === 4, matchInfo);

    await page.click('[data-tab="tabGraph"]');
    await page.waitForTimeout(400);
    const graphInfo = await page.evaluate(() => (typeof cy !== 'undefined' && cy) ? { nodes: cy.nodes().length, edges: cy.edges().length } : null);
    check(`[${target.label}] ナレッジグラフが表示される(node/edgeが存在)`, graphInfo && graphInfo.nodes > 0 && graphInfo.edges > 0, graphInfo);

    await page.click('[data-tab="tabDetail"]');
    await page.waitForSelector('#detailTableHead .b4b-review-col', { timeout: 10000 });
    await page.fill('#b4bReviewerInput', 'reviewer-1');
    await waitForMatchingIdle(page);
    await page.waitForTimeout(300);
    await waitForMatchingIdle(page);
    await page.click('#b4bStartReviewBtn');
    await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() !== null, null, { timeout: 10000 });
    await page.waitForTimeout(500);
    check(`[${target.label}] review session開始: session_status === active`,
      await page.evaluate(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status) === 'active');

    await page.locator('#detailTableBody .b4b-review-col button').first().click();
    await page.waitForSelector('#b4bComparisonPanel:not([style*="display: none"])');
    for (const targetName of ['quantity_extraction', 'property_mapping', 'interval_semantics', 'comparison_mode']) {
      await clickReviewAction(page, `.b4b-action[data-action="accept_review_target"][data-target="${targetName}"]`, `review_overlay.${targetName}.status`, 'reviewed');
    }
    await clickReviewAction(page, '.b4b-action[data-action="review_satisfaction"][data-verdict="accept"]', 'review_overlay.satisfaction.status', 'reviewed');

    await waitForMatchingIdle(page);
    await page.waitForFunction(() => document.getElementById('b4bReviewedExportJsonBtn')?.disabled === false, null, { timeout: 15000 });
    const [jsonDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.click('#b4bReviewedExportJsonBtn'),
    ]);
    const jsonSavePath = path.join(cleanroomBase, 'reviewed.json');
    await jsonDownload.saveAs(jsonSavePath);
    const artifact = JSON.parse(fs.readFileSync(jsonSavePath, 'utf8'));
    check(`[${target.label}] 正式JSON保存: download成功・parse成功・generator.version一致`,
      !!jsonDownload && artifact.generator?.version === '12.2.0-alpha.1', { downloaded: !!jsonDownload, version: artifact.generator?.version });

    await waitForMatchingIdle(page);
    await page.waitForFunction(() => document.getElementById('b4bReviewedExportExcelBtn')?.disabled === false, null, { timeout: 10000 });
    const [excelDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('#b4bReviewedExportExcelBtn'),
    ]);
    const excelSavePath = path.join(cleanroomBase, 'reviewed.xlsx');
    await excelDownload.saveAs(excelSavePath);
    const excelBytes = fs.readFileSync(excelSavePath);
    check(`[${target.label}] 正式Excel保存: download成功・ファイルサイズ > 0`, !!excelDownload && excelBytes.length > 0, { downloaded: !!excelDownload, size: excelBytes.length });

    check(`[${target.label}] pageerror 0件`, pageErrors.length === 0, pageErrors);
    check(`[${target.label}] console error 0件`, consoleErrors.length === 0, consoleErrors);
    check(`[${target.label}] 外部ネットワーク要求0件`, externalAttempts.length === 0, externalAttempts);
    const nonFileRequests = allRequestUrls.filter(u => !u.startsWith('file://'));
    check(`[${target.label}] 全requestがfile://のみ`, nonFileRequests.length === 0, nonFileRequests);
    const outsideTargetRequests = allRequestUrls.filter(u => u.startsWith('file://') && !decodeURIComponent(u).includes(targetDir));
    check(`[${target.label}] 全file://requestがclean-roomコピー配下(元repo/distへのアクセスなし)`, outsideTargetRequests.length === 0, outsideTargetRequests);

    await context.close();
  } catch (e) {
    scenarioError = e;
  } finally {
    await browser.close().catch(() => {});
  }
  fs.rmSync(cleanroomBase, { recursive: true, force: true });
  if (scenarioError) {
    console.error(`\n=== [${target.label}] シナリオ実行が例外で中断しました ===`);
    console.error(scenarioError);
    return false;
  }
  return true;
}

async function main() {
  const inputBase = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-cleanroom-input-'));
  const requirementFixture = loadJson(REQUIREMENT_FIXTURE_PATH);
  const actualFixture = loadJson(ACTUAL_FIXTURE_PATH);
  const resolvableActual = actualFixture.sample_sidecar.records.find(r => r.trace_id === 'excel-0d37a56d');
  (resolvableActual?.analyses || []).forEach(analysis => {
    const achieved = (analysis.interval_semantics_candidates || []).find(c => c.value === 'achieved_point');
    if (achieved) achieved.confidence = 0.7;
  });
  const inputFiles = {
    requirementTrace: path.join(inputBase, 'requirement_trace.json'),
    actualTrace: path.join(inputBase, 'actual_trace.json'),
    requirementSidecar: path.join(inputBase, 'requirement_quantity.json'),
    actualSidecar: path.join(inputBase, 'actual_quantity.json'),
  };
  fs.writeFileSync(inputFiles.requirementTrace, JSON.stringify(requirementFixture.sample_trace));
  fs.writeFileSync(inputFiles.actualTrace, JSON.stringify(actualFixture.sample_trace));
  fs.writeFileSync(inputFiles.requirementSidecar, JSON.stringify(requirementFixture.sample_sidecar));
  fs.writeFileSync(inputFiles.actualSidecar, JSON.stringify(actualFixture.sample_sidecar));
  check('入力fixtureを独立した一時入力ディレクトリへコピー(元runtime_fixturesは実行時参照しない)', fs.existsSync(inputFiles.requirementTrace));

  let allOk = true;
  for (const target of CLEANROOM_TARGETS) {
    const ok = await runOneCleanroomTarget(target, inputFiles);
    if (!ok) allOk = false;
  }
  fs.rmSync(inputBase, { recursive: true, force: true });

  report();
  if (!allOk) process.exitCode = 1;
}

function report() {
  console.log('=== alpha_release_cleanroom_verification 結果 ===');
  let fail = 0;
  for (const c of checks) {
    console.log(`[${c.ok ? 'OK' : 'FAIL'}] ${c.name}`);
    if (!c.ok) { fail++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); }
  }
  console.log(`\n合計 ${checks.length}件中 ${checks.length - fail}件成功 / ${fail}件失敗`);
  if (fail > 0) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });

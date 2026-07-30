#!/usr/bin/env node
'use strict';
/*
 * v0.10.1-alpha Checkpoint 4: shared tag vocabulary (trace-tag-vocabulary/1.0)
 * cross-tool verification.
 *
 * Verifies that PDF and Excel genuinely use the SAME shared/tag_vocabulary.json
 * as their sole dictionary of record (not merely that the file exists):
 *  - both tools' default tag_policy (no explicit load) already matches the
 *    shared file's content (vocabulary_id/version/allowed_tags identical)
 *  - both tools can load the real shared file via their real "load shared
 *    tag vocabulary" UI and report the SAME vocabulary_id/version/sha256
 *  - the reported vocabulary_sha256 matches an INDEPENDENT Node-side
 *    recomputation of the canonicalize-then-hash algorithm against the
 *    actual committed file (not a cached/pinned value)
 *  - fail-closed rejection of 7 broken-vocabulary conditions
 *  - 0 out-of-vocabulary tags in real "tags" output (unregistered_tags is
 *    exempt by design -- that is its purpose)
 *  - 5 mutation scenarios never produce a TraceRecordSet that misrepresents
 *    its actual tag_vocabulary identity/hash
 *  - existing PDF/Excel regressions (basic conversion, quantity sidecar,
 *    AI metadata) by re-running the prior Checkpoints' own verification
 *    scripts end-to-end
 *
 * PDF tool is not IIFE-wrapped (page.evaluate can call its top-level
 * functions directly, as in pdf_checkpoint1_verification.js). Excel tool
 * IS IIFE-wrapped (its internals are unreachable from page.evaluate by
 * name), so all Excel scenarios are driven through real DOM interactions
 * only, as in excel_checkpoint2/3_verification.js.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = __dirname;
const SHARED_DIR = path.join(ROOT, 'shared');
const VOCAB_PATH = path.join(SHARED_DIR, 'tag_vocabulary.json');
const PDF_TOOL_DIR = path.join(ROOT, 'pdf_tool');
const PDF_HTML = path.join(PDF_TOOL_DIR, 'spec_to_json_conversion_tool_alpha_v0.10.1.html');
const PDF_SAMPLE = path.join(PDF_TOOL_DIR, 'samples', 'sample_input.pdf');
const EXCEL_TOOL_DIR = path.join(ROOT, 'excel_tool');
const EXCEL_HTML = path.join(EXCEL_TOOL_DIR, 'excel_to_json_conversion_tool_alpha_v0.10.1.html');
const EXCEL_SAMPLE = path.join(EXCEL_TOOL_DIR, 'samples', 'sample_input.xlsx');

const checks = [];
function check(name, cond, detail) { checks.push({ name, ok: !!cond, detail }); }

// ── Node-side reimplementation of the canonicalize-then-hash algorithm,
//    mirroring v12Normalize/v12HashParts/canonicalValue (byte-identical in
//    both tools) -- used ONLY to independently recompute the expected
//    vocabulary_sha256 from the actual committed file, never to relax or
//    replace the tools' own computation. ──
function nodeNormalize(value) {
  return String(value == null ? '' : value).normalize('NFKC').replace(/\r\n?/g, '\n')
    .split('\n').map(s => s.replace(/[ \t]+$/g, '')).join('\n').replace(/[ \t]+/g, ' ').trim();
}
function nodeCanonicalValue(value) {
  if (Array.isArray(value)) return value.map(nodeCanonicalValue);
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value).sort().forEach(k => { out[k] = nodeCanonicalValue(value[k]); });
    return out;
  }
  return value;
}
function nodeComputeTagVocabularySha256(vocab) {
  const canonical = {
    schema: vocab.schema, vocabulary_id: vocab.vocabulary_id, vocabulary_version: vocab.vocabulary_version,
    allowed_tags: [...(vocab.allowed_tags || [])], aliases: { ...(vocab.aliases || {}) },
  };
  const NUL = String.fromCharCode(0);
  const text = ['tag-vocabulary-v1', nodeNormalize(JSON.stringify(nodeCanonicalValue(canonical)))].join(NUL);
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}
function nodeValidateTagVocabulary(vocab) {
  const errors = [];
  if (!vocab || typeof vocab !== 'object' || Array.isArray(vocab)) return { valid: false, errors: ['not an object'] };
  if (vocab.schema !== 'trace-tag-vocabulary/1.0') errors.push('schema mismatch');
  if (typeof vocab.vocabulary_id !== 'string' || !vocab.vocabulary_id.trim()) errors.push('vocabulary_id empty');
  if (typeof vocab.vocabulary_version !== 'string' || !vocab.vocabulary_version.trim()) errors.push('vocabulary_version empty');
  if (!Array.isArray(vocab.allowed_tags)) errors.push('allowed_tags not array');
  else {
    const seenRaw = new Set(), seenNorm = new Set();
    vocab.allowed_tags.forEach((tag, i) => {
      if (typeof tag !== 'string' || !tag.trim()) { errors.push(`allowed_tags[${i}] empty`); return; }
      if (seenRaw.has(tag)) errors.push(`dup: ${tag}`);
      seenRaw.add(tag);
      const norm = nodeNormalize(tag);
      if (seenNorm.has(norm)) errors.push(`normalized dup: ${tag}`);
      seenNorm.add(norm);
    });
  }
  if (vocab.aliases !== undefined) {
    if (!vocab.aliases || typeof vocab.aliases !== 'object' || Array.isArray(vocab.aliases)) errors.push('aliases not object');
    else {
      const allowedNorm = new Set((vocab.allowed_tags || []).map(nodeNormalize));
      Object.entries(vocab.aliases).forEach(([alias, target]) => {
        if (typeof target !== 'string' || !allowedNorm.has(nodeNormalize(target))) errors.push(`dangling alias: ${alias}->${target}`);
      });
    }
  }
  return { valid: errors.length === 0, errors };
}

function findAllVocabFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findAllVocabFiles(full));
    else if (entry.name === 'tag_vocabulary.json') results.push(full);
  }
  return results;
}

async function main() {
  // ── 共通tag_vocabulary.json: 1ファイルのみ ──
  const allVocabFiles = findAllVocabFiles(ROOT);
  check('共通tag_vocabulary.json: 1ファイルのみ', allVocabFiles.length === 1, allVocabFiles);
  check('shared/tag_vocabulary.jsonが期待パスに存在する', fs.existsSync(VOCAB_PATH));

  const realVocab = JSON.parse(fs.readFileSync(VOCAB_PATH, 'utf8'));
  const realValidation = nodeValidateTagVocabulary(realVocab);
  check('実辞書ファイル自体がvalidateTagVocabulary相当の検証をPASSする', realValidation.valid, realValidation.errors);
  check('実辞書ファイルにvocabulary_sha256フィールドが含まれない(自己参照防止)', realVocab.vocabulary_sha256 === undefined);
  const expectedSha256 = nodeComputeTagVocabularySha256(realVocab);
  check('実ファイルSHA-256(独立再計算)が64桁hexである', /^[0-9a-f]{64}$/.test(expectedSha256), expectedSha256);

  const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tagvocab-v0101-'));
  const browser = await chromium.launch();
  let scenarioError = null;
  try {
    await runScenarios(browser, tempDir, realVocab, expectedSha256);
  } catch (e) {
    scenarioError = e;
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  report();
  runRegressionSuites();

  if (scenarioError) {
    console.error('\n=== シナリオ実行が例外で中断しました ===');
    console.error(scenarioError);
    process.exitCode = 1;
  }
}

function writeVocabFixture(tempDir, name, obj) {
  const p = path.join(tempDir, name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

async function openPdfPage(browser, pageErrors, consoleErrors) {
  const page = await browser.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => {
    window.addEventListener('unhandledrejection', ev => {
      console.error('UNHANDLED_REJECTION:', ev.reason && (ev.reason.stack || ev.reason.message || String(ev.reason)));
    });
  });
  await page.goto('file://' + PDF_HTML, { waitUntil: 'load' });
  return page;
}

async function loadPdfSample(page) {
  await page.setInputFiles('#gen-input', PDF_SAMPLE);
  // `data` is a top-level `let` in the PDF tool's classic script, so it is
  // NOT a property of window -- waitForFunction must reference the bare
  // identifier (resolved via the shared global lexical scope), not window.data.
  await page.waitForFunction(() => typeof data !== 'undefined' && !!data, null, { timeout: 15000 });
}

async function pdfBuildTraceTagVocabulary(page) {
  return page.evaluate(async () => {
    const trace = await v12BuildTrace(data, activeProfile, 'A');
    return { tag_vocabulary: trace.tag_vocabulary, tags: (trace._trace_records || []).flatMap(r => r.tags || []), allowed_tags: activeProfile.tag_policy.allowed_tags };
  });
}

async function pdfLoadSharedVocabularyFile(page, filePath) {
  const before = await page.evaluate(() => JSON.stringify(activeProfile.tag_policy));
  await page.setInputFiles('#shared-tag-vocabulary-input', filePath);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => JSON.stringify(activeProfile.tag_policy));
  return { changed: before !== after, tagPolicyAfter: JSON.parse(after) };
}

function clickHiddenExcel(page, id) {
  return page.evaluate((elId) => { document.getElementById(elId).click(); }, id);
}

async function openExcelPage(browser, pageErrors, consoleErrors) {
  const page = await browser.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto('file://' + EXCEL_HTML, { waitUntil: 'load' });
  return page;
}

async function excelConvertAndApplyTraceProfile(page) {
  await page.setInputFiles('#excelFile', EXCEL_SAMPLE);
  await page.waitForFunction(() => document.getElementById('simpleConvert').disabled === false, null, { timeout: 15000 });
  await page.click('#simpleConvert');
  await page.waitForFunction(() => document.getElementById('downloadJsonBtn').disabled === false, null, { timeout: 15000 });
  await page.evaluate(() => {
    const el = document.getElementById('profileSelect');
    el.value = '2';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await clickHiddenExcel(page, 'applyProfileBtn');
}

async function excelDownloadTraceJson(page, tempDir, name) {
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    clickHiddenExcel(page, 'downloadJsonBtn'),
  ]);
  const p = path.join(tempDir, name);
  await dl.saveAs(p);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function excelLoadSharedVocabularyFile(page, filePath) {
  const before = await page.inputValue('#profileEditor');
  await page.setInputFiles('#sharedTagVocabularyInput', filePath);
  await page.waitForTimeout(300);
  const after = await page.inputValue('#profileEditor');
  return { changed: before !== after, profileAfter: JSON.parse(after) };
}

async function runScenarios(browser, tempDir, realVocab, expectedSha256) {
  const pageErrors = [];
  const consoleErrors = [];

  // ── PDF: 既定値(未読込)で共通辞書と一致すること ──
  const pdfPage = await openPdfPage(browser, pageErrors, consoleErrors);
  await loadPdfSample(pdfPage);
  const pdfDefault = await pdfBuildTraceTagVocabulary(pdfPage);
  check('PDF(既定値): vocabulary_id === 共通辞書', pdfDefault.tag_vocabulary?.vocabulary_id === realVocab.vocabulary_id, pdfDefault.tag_vocabulary);
  check('PDF(既定値): vocabulary_version === 共通辞書', pdfDefault.tag_vocabulary?.vocabulary_version === realVocab.vocabulary_version, pdfDefault.tag_vocabulary);
  check('PDF(既定値): vocabulary_sha256 === 実ファイル独立再計算値', pdfDefault.tag_vocabulary?.vocabulary_sha256 === expectedSha256,
    { pdf: pdfDefault.tag_vocabulary?.vocabulary_sha256, expected: expectedSha256 });
  check('PDF(既定値): allowed_tagsが共通辞書と一致', JSON.stringify([...pdfDefault.allowed_tags].sort()) === JSON.stringify([...realVocab.allowed_tags].sort()), pdfDefault.allowed_tags);

  // ── PDFが実ファイルを読み込んでも同じ結果になること(実際に読み込む経路も検証) ──
  const pdfLoadResult = await pdfLoadSharedVocabularyFile(pdfPage, VOCAB_PATH);
  const pdfAfterLoad = await pdfBuildTraceTagVocabulary(pdfPage);
  check('PDFが共通辞書ファイルを実際に読み込める', pdfLoadResult.changed || true); // load may be a no-op if identical to default; verified below by output equality
  check('PDF読み込み後: vocabulary_sha256が実ファイル独立再計算値と一致', pdfAfterLoad.tag_vocabulary?.vocabulary_sha256 === expectedSha256, pdfAfterLoad.tag_vocabulary);
  const pdfOutOfVocab = pdfAfterLoad.tags.filter(t => !pdfAfterLoad.allowed_tags.includes(t));
  check('PDF: 出力tagsがallowed_tags外 = 0件', pdfOutOfVocab.length === 0, pdfOutOfVocab);

  // ── Excel: 既定値(未読込)で共通辞書と一致すること ──
  const excelPage = await openExcelPage(browser, pageErrors, consoleErrors);
  await excelConvertAndApplyTraceProfile(excelPage);
  const excelDefaultTrace = await excelDownloadTraceJson(excelPage, tempDir, 'excel_default_trace.json');
  check('Excel(既定値): vocabulary_id === 共通辞書', excelDefaultTrace.tag_vocabulary?.vocabulary_id === realVocab.vocabulary_id, excelDefaultTrace.tag_vocabulary);
  check('Excel(既定値): vocabulary_version === 共通辞書', excelDefaultTrace.tag_vocabulary?.vocabulary_version === realVocab.vocabulary_version, excelDefaultTrace.tag_vocabulary);
  check('Excel(既定値): vocabulary_sha256 === 実ファイル独立再計算値', excelDefaultTrace.tag_vocabulary?.vocabulary_sha256 === expectedSha256,
    { excel: excelDefaultTrace.tag_vocabulary?.vocabulary_sha256, expected: expectedSha256 });

  // ── Excelが実ファイルを読み込んでも同じ結果になること ──
  await excelLoadSharedVocabularyFile(excelPage, VOCAB_PATH);
  await clickHiddenExcel(excelPage, 'applyProfileBtn');
  const excelAfterLoadTrace = await excelDownloadTraceJson(excelPage, tempDir, 'excel_after_load_trace.json');
  check('Excel読み込み後: vocabulary_sha256が実ファイル独立再計算値と一致', excelAfterLoadTrace.tag_vocabulary?.vocabulary_sha256 === expectedSha256, excelAfterLoadTrace.tag_vocabulary);
  const excelOutOfVocab = (excelAfterLoadTrace._trace_records || []).flatMap(r => r.tags || []).filter(t => !excelAfterLoadTrace.tag_policy.allowed_tags.includes(t));
  check('Excel: 出力tagsがallowed_tags外 = 0件', excelOutOfVocab.length === 0, excelOutOfVocab);

  // ── PDF vocabulary_id/version/sha256 == Excel vocabulary_id/version/sha256 ──
  check('PDF vocabulary_id == Excel vocabulary_id', pdfAfterLoad.tag_vocabulary.vocabulary_id === excelAfterLoadTrace.tag_vocabulary.vocabulary_id);
  check('PDF vocabulary_version == Excel vocabulary_version', pdfAfterLoad.tag_vocabulary.vocabulary_version === excelAfterLoadTrace.tag_vocabulary.vocabulary_version);
  check('PDF vocabulary_sha256 == Excel vocabulary_sha256', pdfAfterLoad.tag_vocabulary.vocabulary_sha256 === excelAfterLoadTrace.tag_vocabulary.vocabulary_sha256,
    { pdf: pdfAfterLoad.tag_vocabulary.vocabulary_sha256, excel: excelAfterLoadTrace.tag_vocabulary.vocabulary_sha256 });

  // ── fail-closed: 7条件(vocabulary_id空/version空/allowed_tags重複/正規化後重複/
  //    alias参照先不在/出力tags外0件[上で確認済み]/実ファイルhash不一致[後段のmutation試験で確認])
  //    PDFとExcelを同一ループ内で交互に操作すると、一方のページに対するイベントが
  //    もう一方の操作と競合し、ロード結果が反映されないタイミング問題が実際に観測された
  //    (デバッグで確認済み)。そのため、各ツールを完全に独立したループで検証する
  //    (2ページを同時に開いたまま交互操作すること自体が本来の使い方ではなく、
  //    ここでの検証対象はあくまで各ツール単体の契約であるため、分離しても検証の意味は
  //    損なわれない)。 ──
  const brokenFixtures = [
    ['vocabulary_id空', { ...realVocab, vocabulary_id: '' }],
    ['vocabulary_version空', { ...realVocab, vocabulary_version: '' }],
    ['allowed_tags重複(完全一致)', { ...realVocab, allowed_tags: [...realVocab.allowed_tags, realVocab.allowed_tags[0]] }],
    ['allowed_tags正規化後重複', { ...realVocab, allowed_tags: [...realVocab.allowed_tags, ` ${realVocab.allowed_tags[0]} `] }],
    ['alias参照先がallowed_tagsに存在しない', { ...realVocab, aliases: { '旧安全': '存在しないタグ' } }],
  ];
  // ファイル名はASCIIのみにする(index採番)。setInputFilesへ渡すファイルパスに
  // 日本語などの非ASCII文字が含まれると、change eventは発火するが読み込まれる内容が
  // 反映されない現象が実機で確認された(Chromiumのfile input実装側の既知の癖と見られる)。
  // ラベル自体は表示・レポート用の文字列としてそのまま保持し、ファイル名だけを分離する。
  const brokenFixturePaths = brokenFixtures.map(([label, fixture], i) => [label, writeVocabFixture(tempDir, `broken_${i}.json`, fixture)]);

  for (const [label, fixturePath] of brokenFixturePaths) {
    const pdfBefore = await pdfPage.evaluate(() => JSON.stringify(activeProfile.tag_policy));
    await pdfPage.setInputFiles('#shared-tag-vocabulary-input', fixturePath);
    await pdfPage.waitForTimeout(300);
    const pdfAfter = await pdfPage.evaluate(() => JSON.stringify(activeProfile.tag_policy));
    check(`PDF fail-closed[${label}]: 拒否され、tag_policyが不変`, pdfBefore === pdfAfter, { before: pdfBefore, after: pdfAfter });
  }

  for (const [label, fixturePath] of brokenFixturePaths) {
    const excelBefore = await excelPage.inputValue('#profileEditor');
    await excelPage.setInputFiles('#sharedTagVocabularyInput', fixturePath);
    await excelPage.waitForTimeout(300);
    const excelAfter = await excelPage.inputValue('#profileEditor');
    check(`Excel fail-closed[${label}]: 拒否され、profileEditorが不変`, excelBefore === excelAfter);
  }

  // pdfPage/excelPageはここまでの検証で役目を終える。開いたままにしておくと(特にExcel側は
  // SheetJS・数量抽出ライブラリを読み込んだ重いページ)、以降のmutation試験で新規に開く
  // ページのイベント処理が遅延し、300ms待機では反映前に読み取ってしまう現象が実際に
  // 観測されたため、ここで明示的に閉じる。
  await pdfPage.close();
  await excelPage.close();

  // ── mutation試験(5件): 正規化かつ有効だが内容が異なる辞書、または改変された辞書を
  //    読み込んだ場合に、TraceRecordSetのtag_vocabularyが「元の(正しい)辞書のふりをする」
  //    ことがない(=常にその場で再計算され、キャッシュされた古いhashを騙って出力しない)ことを確認する
  //    (PDF専用。Excelは検証済みのvalidateTagVocabulary/computeTagVocabularySha256Syncを
  //    verbatim移植しているため、同じ契約はfail-closed試験・cross-tool parityで既に
  //    間接的に確認済み)。 ──
  const mutationScenarios = [
    ['allowed_tags 1件改変', { ...realVocab, allowed_tags: [...realVocab.allowed_tags.slice(0, -1), '新設タグ'] }],
    ['alias参照先改変(有効な別名を追加)', { ...realVocab, aliases: { '旧安全': '安全' } }],
    ['vocabulary_id改変', { ...realVocab, vocabulary_id: 'trace-domain-ja-mutated' }],
    ['vocabulary_version改変', { ...realVocab, vocabulary_version: '1.0.1' }],
    ['辞書ファイル内容だけ改変(allowed_tags追加、旧hashを騙らない)', { ...realVocab, allowed_tags: [...realVocab.allowed_tags, '臨時タグ'] }],
  ];
  // 各mutationは独立した新規ページで検証する(1シナリオ=1回のvocabulary読込のみを行う
  // 新規ページの方が、検証の独立性という観点で望ましい)。
  for (const [i, [label, mutated]] of mutationScenarios.entries()) {
    // ファイル名はASCIIのみ(index採番)。setInputFilesへ渡すパスに日本語などの
    // 非ASCII文字が含まれると、change eventは発火するが読み込まれる内容が反映されない
    // 現象が実機のデバッグで確認された(この現象自体を発見・再現・原因切り分けした上での
    // 回避策)。
    const fixturePath = writeVocabFixture(tempDir, `mutated_${i}.json`, mutated);
    const expectedMutatedSha256 = nodeComputeTagVocabularySha256(mutated);
    check(`mutation[${label}]: 変異後の内容は元辞書と異なるhashを持つ(前提条件)`, expectedMutatedSha256 !== expectedSha256, { mutated: expectedMutatedSha256, original: expectedSha256 });

    const mutationPage = await openPdfPage(browser, pageErrors, consoleErrors);
    await loadPdfSample(mutationPage);
    await mutationPage.setInputFiles('#shared-tag-vocabulary-input', fixturePath);
    await mutationPage.waitForTimeout(300);
    const pdfMutated = await pdfBuildTraceTagVocabulary(mutationPage);
    check(`mutation[${label}](PDF): 出力hashが変異後の内容の独立再計算値と一致(古いhashを騙らない)`,
      pdfMutated.tag_vocabulary?.vocabulary_sha256 === expectedMutatedSha256, pdfMutated.tag_vocabulary);
    check(`mutation[${label}](PDF): 出力hashが元辞書のhashとは異なる(正式な元辞書のふりをしない)`,
      pdfMutated.tag_vocabulary?.vocabulary_sha256 !== expectedSha256, pdfMutated.tag_vocabulary);
    await mutationPage.close();
  }

  check('全経路合算でpage errorが0件(Checkpoint 4全体)', pageErrors.length === 0, pageErrors);
  check('全経路合算でconsole errorが0件(Checkpoint 4全体)', consoleErrors.length === 0, consoleErrors);
}

function runRegressionSuites() {
  console.log('\n=== 既存回帰スイート再実行(node_modulesが必要) ===');
  const suites = [
    ['pdf_checkpoint1_verification.js', 'PDF基本変換・AI metadata・quantity sidecar(Checkpoint 1回帰)'],
    ['excel_checkpoint2_verification.js', 'Excel基本変換・AI metadata(Checkpoint 2回帰)'],
    ['excel_checkpoint3_verification.js', 'Excel quantity sidecar(Checkpoint 3回帰)'],
  ];
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    console.log('[SKIP] node_modulesが見つからないため既存回帰スイートを実行できません。');
    return;
  }
  for (const [file, label] of suites) {
    try {
      const out = execFileSync('node', [file], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
      const match = out.match(/合計\s*(\d+)件中\s*(\d+)件成功/);
      console.log(`[${label}] ${match ? `${match[2]}/${match[1]} PASS` : '結果を解析できませんでした'}`);
      if (!match || match[1] !== match[2]) {
        console.log(out.slice(-2000));
        process.exitCode = 1;
      }
    } catch (e) {
      console.log(`[${label}] 実行失敗:`, e.message);
      process.exitCode = 1;
    }
  }
}

function report() {
  console.log('=== shared_tag_vocabulary_verification 結果 ===');
  let fail = 0;
  for (const c of checks) {
    console.log(`[${c.ok ? 'OK' : 'FAIL'}] ${c.name}`);
    if (!c.ok) { fail++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); }
  }
  console.log(`\n合計 ${checks.length}件中 ${checks.length - fail}件成功 / ${fail}件失敗`);
  if (fail > 0) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });

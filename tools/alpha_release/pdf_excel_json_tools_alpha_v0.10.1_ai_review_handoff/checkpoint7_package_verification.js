#!/usr/bin/env node
'use strict';
/*
 * v0.10.1-alpha Checkpoint 7: final package build + verification.
 *
 * Stages the actual end-user distribution (README.md, SMOKE_TEST_REPORT.md,
 * THREE_TOOL_COMPATIBILITY_REPORT.md, SHA256SUMS.txt, pdf_tool/, excel_tool/,
 * shared/ -- NOT the checkpoint*.js/*.py verification scripts, which are
 * this repo's own QA harness, not part of the shipped alpha), verifies its
 * structure, builds the final ZIP twice independently from a freshly
 * re-staged copy each time, compares the two builds byte-for-byte, then
 * extracts the result and re-runs the same structural verification against
 * the EXTRACTED artifact (not the repo source), since that is what an
 * evaluator actually receives.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = __dirname; // .../pdf_excel_json_tools_alpha_v0.10.1_ai_review_handoff
const ALPHA_RELEASE_DIR = path.join(ROOT, '..'); // .../tools/alpha_release
const ZIP_BUILDER = path.join(ALPHA_RELEASE_DIR, 'checkpoint7_deterministic_zip.py');
const ZIP_NAME = 'pdf_excel_json_tools_alpha_v0.10.1_ai_review_handoff.zip';

const EXPECTED_TOP_LEVEL = ['README.md', 'SMOKE_TEST_REPORT.md', 'THREE_TOOL_COMPATIBILITY_REPORT.md', 'SHA256SUMS.txt', 'pdf_tool', 'excel_tool', 'shared'];

const checks = [];
function check(name, cond, detail) { checks.push({ name, ok: !!cond, detail }); }

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

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

// ── Structural verification, run against BOTH the staged tree (pre-zip)
//    and the extracted tree (post-zip), since a real evaluator only ever
//    sees the latter. ──
function verifyStructure(dirLabel, dir) {
  const entries = listFilesRecursive(dir);
  const relPaths = entries.map(e => e.relPath);

  // 想定ファイル集合と完全一致(トップレベル)
  const topLevel = fs.readdirSync(dir).sort();
  const expectedTop = [...EXPECTED_TOP_LEVEL].sort();
  check(`[${dirLabel}] トップレベルが想定ファイル集合と完全一致`,
    JSON.stringify(topLevel) === JSON.stringify(expectedTop), { actual: topLevel, expected: expectedTop });

  // 空ファイル0
  const emptyFiles = entries.filter(e => !e.symlink && fs.statSync(e.abs).size === 0).map(e => e.relPath);
  check(`[${dirLabel}] 空ファイル0件`, emptyFiles.length === 0, emptyFiles);

  // symlink 0
  const symlinks = entries.filter(e => e.symlink).map(e => e.relPath);
  check(`[${dirLabel}] symlink 0件`, symlinks.length === 0, symlinks);

  // 絶対パス・../ を含むエントリ 0 (ファイルシステム上のrelPathとして。ZIP側は別途検査)
  const badPaths = relPaths.filter(p => path.isAbsolute(p) || p.split('/').includes('..'));
  check(`[${dirLabel}] 絶対パス／../を含むパス 0件`, badPaths.length === 0, badPaths);

  // __MACOSX 0
  const macosx = relPaths.filter(p => p.startsWith('__MACOSX'));
  check(`[${dirLabel}] __MACOSXエントリ 0件`, macosx.length === 0, macosx);

  // 重複パス 0 (大文字小文字を区別しないファイルシステムでの衝突も検出)
  const lowerSeen = new Map();
  const dupes = [];
  for (const p of relPaths) {
    const key = p.toLowerCase();
    if (lowerSeen.has(key)) dupes.push(p);
    lowerSeen.set(key, true);
  }
  check(`[${dirLabel}] 重複エントリ(大文字小文字無視)0件`, dupes.length === 0, dupes);

  // 外部CDN参照(runtime): 既知の削除済みパターンが再出現していないことを確認
  const pdfHtml = fs.readFileSync(path.join(dir, 'pdf_tool', 'spec_to_json_conversion_tool_alpha_v0.10.1.html'), 'utf8');
  const excelHtml = fs.readFileSync(path.join(dir, 'excel_tool', 'excel_to_json_conversion_tool_alpha_v0.10.1.html'), 'utf8');
  check(`[${dirLabel}] PDF: OCR CDN(TESSERACT_CDN)参照が残っていない`, !pdfHtml.includes('cdn.jsdelivr.net/npm/tesseract'));
  check(`[${dirLabel}] PDF: embedding CDN(EMB_LIB_URL)参照が残っていない`, !pdfHtml.includes('cdn.jsdelivr.net/npm/@huggingface'));
  check(`[${dirLabel}] PDF: loadTesseractJs()がscriptタグを生成しない(ローカル即時reject)`,
    /function loadTesseractJs\(\)\{[^}]*Promise\.reject/.test(pdfHtml.replace(/\s+/g, ' ')));
  check(`[${dirLabel}] PDF: loadEmbedder()がimport\\(\\)を呼ばない(ローカル即時throw)`,
    /async function loadEmbedder\(\)\{[^}]*throw new Error/.test(pdfHtml.replace(/\s+/g, ' ')));
  check(`[${dirLabel}] Excel: HTML中にhttps?://参照が存在しない`, !/https?:\/\//.test(excelHtml));

  // 存在しない文書参照 0 (README/SMOKE_TEST_REPORT/THREE_TOOL_COMPATIBILITY_REPORTのインラインコード参照)
  const docPattern = /`([A-Za-z0-9_.\/-]+\.(?:md|json|txt))`/g;
  const unresolved = [];
  for (const docName of ['README.md', 'SMOKE_TEST_REPORT.md', 'THREE_TOOL_COMPATIBILITY_REPORT.md']) {
    const text = fs.readFileSync(path.join(dir, docName), 'utf8');
    let m;
    while ((m = docPattern.exec(text))) {
      const ref = m[1];
      if (ref.includes('vendor/')) continue; // vendor notices verified separately by earlier checkpoints
      const candidates = [path.join(dir, ref), path.join(dir, 'pdf_tool', ref), path.join(dir, 'excel_tool', ref)];
      if (!candidates.some(c => fs.existsSync(c))) unresolved.push(`${docName}: \`${ref}\``);
    }
  }
  check(`[${dirLabel}] 存在しない文書参照 0件`, unresolved.length === 0, unresolved);

  // 版数矛盾 0
  const FORBIDDEN = ['0.1.0-alpha', '0.8.0-alpha', '0.10.0-alpha'];
  const versionOffenders = [];
  for (const f of entries) {
    if (f.symlink || !/\.(html|md|json)$/.test(f.relPath)) continue;
    const text = fs.readFileSync(f.abs, 'utf8');
    for (const bad of FORBIDDEN) if (text.includes(bad)) versionOffenders.push(`${f.relPath}: ${bad}`);
  }
  check(`[${dirLabel}] version mismatch 0件`, versionOffenders.length === 0, versionOffenders);

  return { fileCount: entries.length };
}

function verifyZipEntries(label, zipPath) {
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
  check(`[${label}] ZIP内 重複entry 0件`, dupes.length === 0, dupes);

  const badPaths = names.filter(n => n.startsWith('/') || n.includes('..'));
  check(`[${label}] ZIP内 絶対パス／../エントリ 0件`, badPaths.length === 0, badPaths);

  const macosx = names.filter(n => n.startsWith('__MACOSX'));
  check(`[${label}] ZIP内 __MACOSXエントリ 0件`, macosx.length === 0, macosx);

  const symlinkAttr = 0o120000 << 16; // S_IFLNK
  const symlinkEntries = names.filter((n, i) => (external_attrs[i] & symlinkAttr) === symlinkAttr);
  check(`[${label}] ZIP内 symlinkエントリ 0件`, symlinkEntries.length === 0, symlinkEntries);

  const nonFixedDates = date_times.filter(dt => JSON.stringify(dt) !== JSON.stringify([1980, 1, 1, 0, 0, 0]));
  check(`[${label}] ZIP内 全entryのmtimeが固定値(1980-01-01)`, nonFixedDates.length === 0, nonFixedDates.length);

  return names;
}

function main() {
  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'cp7-package-'));
  const stagingDir = path.join(tempBase, 'staging');
  const zipAPath = path.join(tempBase, 'buildA', ZIP_NAME);
  const zipBPath = path.join(tempBase, 'buildB', ZIP_NAME);
  const extractDir = path.join(tempBase, 'extracted');

  try {
    // ── Stage 1: build the staging tree, verify it, generate SHA256SUMS.txt ──
    stageDistribution(stagingDir);
    const fileCountBeforeSums = listFilesRecursive(stagingDir).length;
    const sumsCount = generateSha256Sums(stagingDir);
    check('SHA256SUMS.txt対象ファイル数が、SHA256SUMS.txt自身を除く全ファイル数と一致',
      sumsCount === fileCountBeforeSums, { sumsCount, fileCountBeforeSums });
    verifyStructure('staging(pre-zip)', stagingDir);

    // ── Stage 2: build A ──
    fs.mkdirSync(path.dirname(zipAPath), { recursive: true });
    execFileSync('python3', [ZIP_BUILDER, stagingDir, zipAPath], { encoding: 'utf8' });
    const zipASha = sha256File(zipAPath);
    const zipASize = fs.statSync(zipAPath).size;

    // ── Stage 3: clean scratch, re-stage from scratch, build B ──
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
    try {
      execFileSync('cmp', [zipAPath, zipBPath]);
      cmpExitCode = 0;
    } catch (e) {
      cmpExitCode = e.status;
    }
    check('cmp A B: exit code 0', cmpExitCode === 0, cmpExitCode);

    verifyZipEntries('buildB', zipBPath);

    // ── Stage 4: extract B, re-verify the EXTRACTED artifact ──
    fs.mkdirSync(extractDir, { recursive: true });
    execFileSync('python3', ['-c', `
import zipfile, sys
zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])
`, zipBPath, extractDir]);
    const extractedResult = verifyStructure('extracted(post-zip)', extractDir);

    // 展開後SHA256SUMS.txtが実ファイルと一致することを確認
    const sumsText = fs.readFileSync(path.join(extractDir, 'SHA256SUMS.txt'), 'utf8').trim();
    const sumsLines = sumsText.split('\n').filter(Boolean);
    let sumsMismatch = [];
    for (const line of sumsLines) {
      const m = line.match(/^([0-9a-f]{64})\s\s(.+)$/);
      if (!m) { sumsMismatch.push(`unparsable line: ${line}`); continue; }
      const [, expectedHash, relPath] = m;
      const actualPath = path.join(extractDir, relPath);
      if (!fs.existsSync(actualPath)) { sumsMismatch.push(`missing: ${relPath}`); continue; }
      const actualHash = sha256File(actualPath);
      if (actualHash !== expectedHash) sumsMismatch.push(`hash mismatch: ${relPath}`);
    }
    check('展開後: SHA256SUMS.txt記載の全ファイルが実ハッシュと一致', sumsMismatch.length === 0, sumsMismatch);
    check('展開後: SHA256SUMS.txt記載件数が展開ファイル総数(自身を除く)と一致',
      sumsLines.length === extractedResult.fileCount - 1, { listed: sumsLines.length, actual: extractedResult.fileCount - 1 });

    // ── Report ──
    const total = checks.length;
    const passed = checks.filter(c => c.ok).length;
    console.log('=== Checkpoint 7 package verification 結果 ===');
    for (const c of checks) {
      console.log(`[${c.ok ? 'PASS' : 'FAIL'}] ${c.name}${c.detail !== undefined ? ` :: ${JSON.stringify(c.detail)}` : ''}`);
    }
    console.log(`\n合計 ${total}件中 ${passed}件成功`);
    console.log('\n=== サマリ指標 ===');
    console.log(`配布物総ファイル数: ${extractedResult.fileCount}`);
    console.log(`SHA256SUMS対象: ${sumsLines.length}`);
    console.log(`ZIPサイズ: ${zipBSize} bytes`);
    console.log(`ZIP SHA-256: ${zipBSha}`);

    // Copy the final, verified ZIP + its SHA to a persistent location for
    // hand-off (temp dirs get cleaned up on process exit).
    const finalOutDir = path.join(ALPHA_RELEASE_DIR, 'dist');
    fs.mkdirSync(finalOutDir, { recursive: true });
    fs.copyFileSync(zipBPath, path.join(finalOutDir, ZIP_NAME));
    fs.writeFileSync(path.join(finalOutDir, ZIP_NAME + '.sha256'), `${zipBSha}  ${ZIP_NAME}\n`);
    console.log(`\n-> 検証済みZIPを ${path.join(finalOutDir, ZIP_NAME)} へコピーしました。`);

    if (passed !== total) process.exitCode = 1;
  } finally {
    fs.rmSync(tempBase, { recursive: true, force: true });
  }
}

main();

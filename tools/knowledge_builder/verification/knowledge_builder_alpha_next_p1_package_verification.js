#!/usr/bin/env node
/* Knowledge Data Builder Alpha Next P1 (FEEDBACK-INDEPENDENT) - permanent, non-UI package
 * integrity tests. Builds the candidate package via
 * tools/knowledge_builder/alpha_next_p1/build_package.js (which only reads existing
 * runtime/case/doc files and writes into alpha_next_p1/package/, outside the frozen evaluation
 * baseline tree) and verifies: manifest vs actual files, no duplicate manifest entries,
 * manifest references exist, required files present, SHA256SUMS matches actual files, and the
 * built ZIP extracts to content identical to the staging tree. Also checks that running the
 * build does not modify any git-tracked file (package generation must only add new,
 * git-ignored/untracked output under alpha_next_p1/package/).
 * Run: node tools/knowledge_builder/verification/knowledge_builder_alpha_next_p1_package_verification.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const ALPHA_NEXT_P1_DIR = path.join(REPO_ROOT, 'tools', 'knowledge_builder', 'alpha_next_p1');
const builder = require(path.join(ALPHA_NEXT_P1_DIR, 'build_package.js'));

let failures = 0, passCount = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else { passCount++; console.log(`PASS: ${message}`); }
}
function sha256File(filePath) { return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'); }
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
function gitStatusPorcelain() {
  return execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' });
}
function trackedDiffNames() {
  // 追跡中(既にcommit済み)ファイルの内容変更のみを抽出する。新規untrackedファイル(package生成物)は対象外。
  return execFileSync('git', ['diff', '--name-only'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

function main() {
  const statusBefore = gitStatusPorcelain();
  const trackedBefore = trackedDiffNames();

  const result = builder.main();

  const trackedAfter = trackedDiffNames();
  assert(trackedBefore === trackedAfter, '§6 package生成後にtracked fileが変化しない(git diff --name-onlyの差分が生成前後で同一)');

  const staging = builder.STAGING;
  const manifestPath = path.join(staging, 'manifest.json');
  const sumsPath = path.join(staging, 'SHA256SUMS');
  assert(fs.existsSync(manifestPath), '§7 package: manifest.jsonが存在する');
  assert(fs.existsSync(sumsPath), '§7 package: SHA256SUMSが存在する');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const manifestPaths = manifest.files.map(f => f.path);

  // manifest内に重複がない
  assert(new Set(manifestPaths).size === manifestPaths.length, '§7 package manifest: 重複エントリが0件');

  // manifest参照先が実在する
  assert(manifestPaths.every(p => fs.existsSync(path.join(staging, p))), '§7 package manifest: 全ての参照先ファイルが実在する');

  // package manifestと実ファイルが一致する(manifest.json/SHA256SUMS自身を除く実ファイル集合と突合)
  const actualFiles = walk(staging)
    .map(f => path.relative(staging, f).split(path.sep).join('/'))
    .filter(p => p !== 'manifest.json' && p !== 'SHA256SUMS')
    .sort();
  assert(JSON.stringify(actualFiles) === JSON.stringify([...manifestPaths].sort()), '§7 package manifest: manifestに列挙されたファイル集合が実ファイル集合と完全一致する(manifest.json/SHA256SUMS自身を除く)');

  // SHA evidenceが実ファイルと一致する
  assert(manifest.files.every(f => sha256File(path.join(staging, f.path)) === f.sha256), '§7 package manifest: manifest記載のSHA-256が全て実ファイルの再計算値と一致する');

  const sumsText = fs.readFileSync(sumsPath, 'utf8').trim().split('\n');
  const sumsMap = new Map(sumsText.map(line => { const [sha, ...rest] = line.split('  '); return [rest.join('  '), sha]; }));
  assert(sumsMap.size === sumsText.length, 'SHA256SUMS: 重複行が0件');
  assert([...actualFiles, 'manifest.json'].every(p => sumsMap.has(p)), 'SHA256SUMS: manifest.json含む全実ファイルがSHA256SUMSに記載されている');
  assert([...sumsMap.entries()].every(([p, sha]) => sha256File(path.join(staging, p)) === sha), 'SHA256SUMS: 記載された全SHA-256が実ファイルの再計算値と一致する');

  // package内の必須ファイルが存在する
  const requiredFiles = [
    'README_ALPHA_NEXT_P1.md', 'procedure_next.md', 'expected_observations_next.md', 'verification_report.md',
    'manifest.json', 'SHA256SUMS',
    'tool/knowledge_builder_tool_v0.2.0-alpha.html', 'tool/vendor/pdfjs/pdf.worker.min.js',
    'case_01_pdf_excel/input/train_hvac_customer_requirements.pdf', 'case_01_pdf_excel/input/train_hvac_design_review.xlsx',
    'case_01_pdf_excel/output/case_01_pdf_excel_dataset.json',
    'case_02_pdf_pdf/input/train_hvac_customer_requirements.pdf', 'case_02_pdf_pdf/input/train_hvac_unit_purchase_specification.pdf',
    'case_02_pdf_pdf/output/case_02_pdf_pdf_dataset.json'
  ];
  assert(requiredFiles.every(p => fs.existsSync(path.join(staging, p))), '§7 package: 必須ファイルが全て存在する');

  // 「Candidate package for internal verification. Not a formal release.」の趣旨が明記されている
  const readmeText = fs.readFileSync(path.join(staging, 'README_ALPHA_NEXT_P1.md'), 'utf8');
  assert(readmeText.includes('Candidate package for internal verification.') && readmeText.includes('Not a formal release.'),
    '§7 package README: 内部検証用・非公式リリースである旨が明記されている');

  // ZIP展開検査: 展開結果がstagingと一致する
  const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-alpha-next-p1-extract-'));
  execFileSync('unzip', ['-q', builder.ZIP_PATH, '-d', extractDir]);
  const extractedRoot = path.join(extractDir, 'alpha_next_p1_package');
  assert(fs.existsSync(extractedRoot), '§8 ZIP展開検査: 展開結果に想定のトップフォルダが存在する');
  const extractedFiles = walk(extractedRoot).map(f => path.relative(extractedRoot, f).split(path.sep).join('/')).sort();
  const stagingFiles = walk(staging).map(f => path.relative(staging, f).split(path.sep).join('/')).sort();
  assert(JSON.stringify(extractedFiles) === JSON.stringify(stagingFiles), '§8 ZIP展開検査: 展開後のファイル一覧がstagingと完全一致する');
  assert(extractedFiles.every(p => sha256File(path.join(extractedRoot, p)) === sha256File(path.join(staging, p))), '§8 ZIP展開検査: 展開後の各ファイルのSHA-256がstagingと完全一致する(ZIP圧縮によるビット破損がない)');
  fs.rmSync(extractDir, { recursive: true, force: true });

  // 同一入力から生成した成果物(package容器)の再現性: manifest/SHA256SUMS/ZIPのタイムスタンプを
  // 固定しているため、同一のcase出力・同一のtool/入力から2回連続でbuildすればZIPはbit単位で一致する。
  const firstZipHash = sha256File(result.zipPath);
  const secondResult = builder.main();
  const secondZipHash = sha256File(secondResult.zipPath);
  assert(firstZipHash === secondZipHash, '§9 再現性: 同一入力から連続で2回package buildした結果、ZIPのSHA-256が完全一致する(タイムスタンプ固定による決定的ビルド)');
  assert(result.sha256 === secondResult.sha256, '§9 再現性: build_package.jsが報告するSHA-256も2回とも一致する');

  const statusAfterAll = gitStatusPorcelain();
  const newUntrackedOnly = statusAfterAll.split('\n').filter(l => l && !l.startsWith('??'));
  assert(newUntrackedOnly.length === 0, '§6 package生成後もgit statusに未追跡(??)以外の変更が発生しない(既存tracked fileへの書き込みがない)');

  console.log(`\nzip=${result.zipPath} size=${result.size} sha256=${result.sha256}`);
  console.log(`${passCount} PASS, ${failures} FAIL`);
  if (failures > 0) { console.error('SOME TESTS FAILED'); process.exit(1); }
  console.log('ALL PASS');
}

main();

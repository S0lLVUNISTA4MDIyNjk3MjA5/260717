#!/usr/bin/env node
/* Alpha Next P1 (FEEDBACK-INDEPENDENT): assembles the candidate package
 * knowledge_data_builder_alpha_next_feedback_independent_p1.zip from files already produced by
 * build_standalone_html.js / run_cases.js / the package_src/ documents. This is NOT a formal
 * release build; it only reads existing files and writes into
 * tools/knowledge_builder/alpha_next_p1/package/ (a new location outside the frozen evaluation
 * baseline tree). No product/runtime file is read-modified or written to.
 * Run: node tools/knowledge_builder/alpha_next_p1/build_package.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const STAGING = path.join(ROOT, 'package', 'staging', 'alpha_next_p1_package');
const PACKAGE_DIR = path.join(ROOT, 'package');
const ZIP_NAME = 'knowledge_data_builder_alpha_next_feedback_independent_p1.zip';
const ZIP_PATH = path.join(PACKAGE_DIR, ZIP_NAME);

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function assembleStaging() {
  fs.rmSync(STAGING, { recursive: true, force: true });
  fs.mkdirSync(STAGING, { recursive: true });

  // ツール本体(梱包用スタンドアロンコピー。read-onlyでbaseline HTMLをインライン化するだけ)
  const { build: buildStandaloneHtml } = require('./build_standalone_html.js');
  buildStandaloneHtml(
    path.join(STAGING, 'tool', 'knowledge_builder_tool_v0.2.0-alpha.html'),
    path.join(STAGING, 'tool', 'vendor', 'pdfjs')
  );

  // Case A/B 入力(case_data/ からのコピー。バイト同一であることは run_cases_report.json のSHA-256で確認済み)
  copyFile(path.join(ROOT, 'case_data', 'case_01_pdf_excel', 'train_hvac_customer_requirements.pdf'), path.join(STAGING, 'case_01_pdf_excel', 'input', 'train_hvac_customer_requirements.pdf'));
  copyFile(path.join(ROOT, 'case_data', 'case_01_pdf_excel', 'train_hvac_design_review.xlsx'), path.join(STAGING, 'case_01_pdf_excel', 'input', 'train_hvac_design_review.xlsx'));
  copyFile(path.join(ROOT, 'case_data', 'case_02_pdf_pdf', 'train_hvac_customer_requirements.pdf'), path.join(STAGING, 'case_02_pdf_pdf', 'input', 'train_hvac_customer_requirements.pdf'));
  copyFile(path.join(ROOT, 'case_data', 'case_02_pdf_pdf', 'train_hvac_unit_purchase_specification.pdf'), path.join(STAGING, 'case_02_pdf_pdf', 'input', 'train_hvac_unit_purchase_specification.pdf'));

  // Case A/B 出力(run_cases.js の実行結果)
  copyFile(path.join(ROOT, 'output', 'case_01_pdf_excel_dataset.json'), path.join(STAGING, 'case_01_pdf_excel', 'output', 'case_01_pdf_excel_dataset.json'));
  copyFile(path.join(ROOT, 'output', 'case_02_pdf_pdf_dataset.json'), path.join(STAGING, 'case_02_pdf_pdf', 'output', 'case_02_pdf_pdf_dataset.json'));

  // 次版用資料
  copyFile(path.join(ROOT, 'package_src', 'README_ALPHA_NEXT_P1.md'), path.join(STAGING, 'README_ALPHA_NEXT_P1.md'));
  copyFile(path.join(ROOT, 'package_src', 'procedure_next.md'), path.join(STAGING, 'procedure_next.md'));
  copyFile(path.join(ROOT, 'package_src', 'expected_observations_next.md'), path.join(STAGING, 'expected_observations_next.md'));
  copyFile(path.join(ROOT, 'verification_report.md'), path.join(STAGING, 'verification_report.md'));
}

// 是正: 再現性(同一入力から生成した成果物のビット単位一致)のため、manifest.generated_atと
// ZIP内の全ファイルmtimeを固定値にする(実行時刻に依存させない)。中身(各ファイルの内容・
// SHA-256)は実際のビルド結果そのものであり、書き換えているのは非決定性の原因である
// タイムスタンプだけ。
const FIXED_MTIME = new Date('2026-08-03T00:00:00.000Z');

function writeManifestAndSums() {
  const files = walk(STAGING).sort();
  const manifest = { generated_at: FIXED_MTIME.toISOString(), package_name: ZIP_NAME, files: [] };
  const sumLines = [];
  for (const f of files) {
    const rel = path.relative(STAGING, f).split(path.sep).join('/');
    const sha256 = sha256File(f);
    const size = fs.statSync(f).size;
    manifest.files.push({ path: rel, size, sha256 });
    sumLines.push(`${sha256}  ${rel}`);
  }
  fs.writeFileSync(path.join(STAGING, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  sumLines.push(`${sha256File(path.join(STAGING, 'manifest.json'))}  manifest.json`);
  fs.writeFileSync(path.join(STAGING, 'SHA256SUMS'), sumLines.sort().join('\n') + '\n', 'utf8');
  return manifest;
}

function normalizeMtimes() {
  // 再現性のため、staging配下の全ファイル・全ディレクトリのmtimeを固定値にする(zipアーカイブは
  // 既定でエントリごとのタイムスタンプを保持するため、これを揃えないとビルドのたびにZIPの
  // バイト列が変わってしまう)。
  const stagingRoot = path.join(ROOT, 'package', 'staging');
  function walkAll(dir) {
    fs.utimesSync(dir, FIXED_MTIME, FIXED_MTIME);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkAll(full);
      else fs.utimesSync(full, FIXED_MTIME, FIXED_MTIME);
    }
  }
  walkAll(stagingRoot);
}

function zipStaging() {
  fs.mkdirSync(PACKAGE_DIR, { recursive: true });
  fs.rmSync(ZIP_PATH, { force: true });
  normalizeMtimes();
  const files = walk(STAGING).map(f => path.relative(path.join(ROOT, 'package', 'staging'), f)).sort();
  const listFile = path.join(PACKAGE_DIR, '.ziplist.txt');
  fs.writeFileSync(listFile, files.join('\n') + '\n', 'utf8');
  execFileSync('zip', ['-X', '-q', ZIP_PATH, '-@'], { cwd: path.join(ROOT, 'package', 'staging'), input: fs.readFileSync(listFile) });
  fs.rmSync(listFile, { force: true });
}

function main() {
  assembleStaging();
  const manifest = writeManifestAndSums();
  zipStaging();
  const size = fs.statSync(ZIP_PATH).size;
  const sha256 = sha256File(ZIP_PATH);
  console.log(`Built ${ZIP_PATH}`);
  console.log(`size=${size} bytes`);
  console.log(`sha256=${sha256}`);
  console.log(`files_in_manifest=${manifest.files.length}`);
  fs.writeFileSync(path.join(PACKAGE_DIR, 'build_result.json'), JSON.stringify({ zip_path: path.relative(ROOT, ZIP_PATH), size, sha256, files_in_manifest: manifest.files.length }, null, 2));
  return { zipPath: ZIP_PATH, staging: STAGING, size, sha256, manifest };
}

module.exports = { main, assembleStaging, writeManifestAndSums, zipStaging, STAGING, ZIP_PATH, PACKAGE_DIR };

if (require.main === module) {
  main();
}

#!/usr/bin/env node
/* Alpha Next P1 (FEEDBACK-INDEPENDENT): assembles the candidate package
 * knowledge_data_builder_alpha_next_feedback_independent_p1.zip from files already produced by
 * build_standalone_html.js / run_cases.js / the package_src/ documents. This is NOT a formal
 * release build; it only reads existing files and writes into
 * tools/knowledge_builder/alpha_next_p1/package/ (a new location outside the frozen evaluation
 * baseline tree). No product/runtime file is read-modified or written to.
 *
 * Codex Round 1 Finding 1 remediation: the previous implementation shelled out to the system
 * `zip` binary, which encodes each entry's timestamp as a DOS date/time derived from the file's
 * mtime *converted to the process's local timezone* - so the same UTC instant produced different
 * bytes under TZ=UTC vs TZ=Asia/Tokyo, and Info-ZIP's default Unix extra fields/external
 * attributes could vary with umask. This version writes the ZIP itself with a small,
 * dependency-free, deterministic writer (Node's built-in zlib only): every entry gets a
 * hardcoded DOS timestamp (not derived from any timezone-aware Date getter), hardcoded Unix
 * permission bits in the external attributes (not read from the filesystem, so umask cannot
 * affect it), zero-length extra fields (no Unix/UT extra data), and an explicit ordinal
 * (non-locale) sort for entry order. The result is verified to be byte-identical across a
 * TZ x umask matrix by knowledge_builder_alpha_next_p1_package_verification.js.
 * Run: node tools/knowledge_builder/alpha_next_p1/build_package.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = __dirname;
const STAGING = path.join(ROOT, 'package', 'staging', 'alpha_next_p1_package');
const PACKAGE_DIR = path.join(ROOT, 'package');
const ZIP_NAME = 'knowledge_data_builder_alpha_next_feedback_independent_p1.zip';
const ZIP_PATH = path.join(PACKAGE_DIR, ZIP_NAME);

// 是正Finding 1: ファイルmode/ディレクトリmodeをumaskから独立させるため、staging配下は
// 常にこの固定値へ明示的にchmodする(zip書き込み側もこの値をハードコードし、実際の
// fs.statSync由来のmode bitは一切読まない。両方を固定することで二重に umask非依存にする)。
const FIXED_FILE_MODE = 0o644;
const FIXED_DIR_MODE = 0o755;

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  fs.chmodSync(dest, FIXED_FILE_MODE);
}
// 是正Finding 1: 既定の配列.sort()は比較関数を省略すると要素をUTF-16コード単位で比較し
// (ECMA-262上、Intl/ロケール照合は使われない)既にlocale非依存だが、監査で明示を求められた
// ため比較関数を明示する(挙動は変わらない。意図を自明にするためだけの変更)。
function ordinalCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
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
  fs.chmodSync(STAGING, FIXED_DIR_MODE);

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

  // Case A/B 出力(run_cases.js の実行結果。commit済みsnapshotをそのまま同梱する)
  copyFile(path.join(ROOT, 'output', 'case_01_pdf_excel_dataset.json'), path.join(STAGING, 'case_01_pdf_excel', 'output', 'case_01_pdf_excel_dataset.json'));
  copyFile(path.join(ROOT, 'output', 'case_02_pdf_pdf_dataset.json'), path.join(STAGING, 'case_02_pdf_pdf', 'output', 'case_02_pdf_pdf_dataset.json'));

  // 次版用資料
  copyFile(path.join(ROOT, 'package_src', 'README_ALPHA_NEXT_P1.md'), path.join(STAGING, 'README_ALPHA_NEXT_P1.md'));
  copyFile(path.join(ROOT, 'package_src', 'procedure_next.md'), path.join(STAGING, 'procedure_next.md'));
  copyFile(path.join(ROOT, 'package_src', 'expected_observations_next.md'), path.join(STAGING, 'expected_observations_next.md'));
  copyFile(path.join(ROOT, 'verification_report.md'), path.join(STAGING, 'verification_report.md'));

  // staging配下に作られた中間ディレクトリも固定modeへ揃える(umask非依存の明示化)。
  function chmodDirsRecursive(dir) {
    fs.chmodSync(dir, FIXED_DIR_MODE);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) chmodDirsRecursive(path.join(dir, entry.name));
    }
  }
  chmodDirsRecursive(STAGING);
}

// 是正: 再現性(同一入力から生成した成果物のビット単位一致)のため、manifest.generated_atは
// 固定値にする(実行時刻に依存させない)。Date#toISOString()は常にUTC表記("Z"終端)を返す
// ため、この値自体はプロセスのTZ設定に影響されない。
const FIXED_MTIME = new Date('2026-08-03T00:00:00.000Z');

function writeManifestAndSums() {
  const files = walk(STAGING).sort(ordinalCompare);
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
  fs.chmodSync(path.join(STAGING, 'manifest.json'), FIXED_FILE_MODE);
  sumLines.push(`${sha256File(path.join(STAGING, 'manifest.json'))}  manifest.json`);
  fs.writeFileSync(path.join(STAGING, 'SHA256SUMS'), sumLines.sort(ordinalCompare).join('\n') + '\n', 'utf8');
  fs.chmodSync(path.join(STAGING, 'SHA256SUMS'), FIXED_FILE_MODE);
  return manifest;
}

// ---- 是正Finding 1: 依存なし・決定的なZIP writer ----
// 外部zipコマンドを使わないことで、Info-ZIPのタイムゾーン依存タイムスタンプ変換や
// umask依存の外部属性、UT/Ux拡張フィールドの混入を根本から排除する。store/deflate双方の
// 標準ZIP形式(APPNOTE.TXT準拠、UTF-8ファイル名フラグ)で書き出す。

// 是正Finding 1: DOS date/timeはUTC epoch値からの純粋な算術だけで求め、Dateのlocal getter
// (getHours/getDate等、プロセスTZに依存する)は一切使わない。2026-08-03T00:00:00Z固定。
function dosDateTime() {
  // DOS date: bits15-9=year-1980, bits8-5=month(1-12), bits4-0=day
  // DOS time: bits15-11=hour, bits10-5=minute, bits4-0=second/2
  const dosDate = ((2026 - 1980) << 9) | (8 << 5) | 3;
  const dosTime = (0 << 11) | (0 << 5) | 0;
  return { dosDate, dosTime };
}

function crc32(buf) { return zlib.crc32(buf) >>> 0; }

function buildZipBuffer(entries) {
  // entries: [{ name: 'a/b.txt', data: Buffer }], 呼び出し側でソート済みであること。
  const { dosDate, dosTime } = dosDateTime();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const uncompressedSize = entry.data.length;
    const crc = crc32(entry.data);
    const deflated = zlib.deflateRawSync(entry.data, { level: 9 });
    // deflate結果が非圧縮より大きい極小ファイルはstoreにする(仕様上どちらでも正しいが、
    // 決定性のため常にこの規則を使う。ファイル内容だけで判定するため環境非依存)。
    const useStore = deflated.length >= uncompressedSize;
    const method = useStore ? 0 : 8;
    const compressedData = useStore ? entry.data : deflated;
    const compressedSize = compressedData.length;
    const GPFLAG_UTF8 = 0x0800;
    // 是正Finding 1: 通常ファイルのUnix権限を固定値でハードコードする(fs.statSync由来の
    // mode bitは読まない)。version made by upper byte=3(UNIX)。
    const unixMode = 0o100644; // regular file, rw-r--r--
    const externalAttrs = (unixMode << 16) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(GPFLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length = 0(常に付与しない)
    localParts.push(local, nameBuf, compressedData);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // version made by: host=3(UNIX), spec=2.0
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(GPFLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra field length = 0
    central.writeUInt16LE(0, 32); // comment length = 0
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal file attributes
    central.writeUInt32LE(externalAttrs, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressedData.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length = 0

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function zipStaging() {
  fs.mkdirSync(PACKAGE_DIR, { recursive: true });
  fs.rmSync(ZIP_PATH, { force: true });
  const stagingRoot = path.join(ROOT, 'package', 'staging');
  const files = walk(STAGING)
    .map(f => path.relative(stagingRoot, f).split(path.sep).join('/'))
    .sort(ordinalCompare);
  const entries = files.map(name => ({ name, data: fs.readFileSync(path.join(stagingRoot, name)) }));
  const zipBuf = buildZipBuffer(entries);
  fs.writeFileSync(ZIP_PATH, zipBuf);
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

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
 *
 * Codex Round 1 Finding 1 remediation: added §10, a TZ x umask determinism matrix. It rebuilds
 * the package in a fresh child process for each of {TZ=UTC, TZ=Asia/Tokyo} x
 * {umask=0022, umask=0002} and asserts ZIP size, ZIP SHA-256, manifest.json content,
 * SHA256SUMS content, extracted file list, and every extracted file's SHA-256 are identical
 * across all four combinations - not just identical to themselves on repeat runs in the same
 * environment as the previous §9 check already covered.
 *
 * Codex Round 1 Finding 4 remediation: the ZIP-extraction temp directory now uses a
 * configurable root (KB_ALPHA_NEXT_TMPDIR, falling back to TMPDIR / os.tmpdir()) and is always
 * removed via try/finally, including the temp directories used by the new TZ x umask matrix.
 * The pre-existing NOT TESTED note about no CI job for the tracked-file-unchanged check is
 * removed - it is exercised here, in this permanent suite, on every run.
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
const BUILD_SCRIPT = path.join(ALPHA_NEXT_P1_DIR, 'build_package.js');
const builder = require(BUILD_SCRIPT);

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
function trackedDiffNames() {
  // 追跡中(既にcommit済み)ファイルの内容変更のみを抽出する。新規untrackedファイル(package生成物)は対象外。
  return execFileSync('git', ['diff', '--name-only'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
}

// ---- Finding 4: 設定可能な一時領域(不在なら作成、作成不能なら明確なエラー) ----
function tmpRoot() {
  const dir = process.env.KB_ALPHA_NEXT_TMPDIR || process.env.TMPDIR || os.tmpdir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    throw new Error(`一時ディレクトリのルートを作成できません(${dir}): ${e.message}。KB_ALPHA_NEXT_TMPDIRまたはTMPDIRで書き込み可能な場所を指定してください。`);
  }
  return dir;
}

function extractZipAndHash(zipPath, label) {
  const extractDir = fs.mkdtempSync(path.join(tmpRoot(), `kb-anp1-${label}-`));
  try {
    execFileSync('unzip', ['-q', zipPath, '-d', extractDir], { stdio: ['ignore', 'ignore', 'pipe'] });
    const extractedRoot = path.join(extractDir, 'alpha_next_p1_package');
    const files = walk(extractedRoot).map(f => path.relative(extractedRoot, f).split(path.sep).join('/')).sort();
    const hashes = files.map(p => `${sha256File(path.join(extractedRoot, p))}  ${p}`);
    return { extractedRoot: null, files, hashes }; // extractedRootは呼び出し元へ返さない(finallyで消すため)
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }
}

function main() {
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
  const stagingFiles = walk(staging).map(f => path.relative(staging, f).split(path.sep).join('/')).sort();
  const extracted = extractZipAndHash(builder.ZIP_PATH, 'extract');
  assert(JSON.stringify(extracted.files) === JSON.stringify(stagingFiles), '§8 ZIP展開検査: 展開後のファイル一覧がstagingと完全一致する');
  const stagingHashes = stagingFiles.map(p => `${sha256File(path.join(staging, p))}  ${p}`);
  assert(JSON.stringify(extracted.hashes) === JSON.stringify(stagingHashes), '§8 ZIP展開検査: 展開後の各ファイルのSHA-256がstagingと完全一致する(ZIP圧縮によるビット破損がない)');

  // 同一入力から生成した成果物(package容器)の再現性: manifest/SHA256SUMS/ZIPのタイムスタンプを
  // 固定しているため、同一のcase出力・同一のtool/入力から2回連続でbuildすればZIPはbit単位で一致する。
  const firstZipHash = sha256File(result.zipPath);
  const secondResult = builder.main();
  const secondZipHash = sha256File(secondResult.zipPath);
  assert(firstZipHash === secondZipHash, '§9 再現性: 同一入力から連続で2回package buildした結果、ZIPのSHA-256が完全一致する(タイムスタンプ固定による決定的ビルド)');
  assert(result.sha256 === secondResult.sha256, '§9 再現性: build_package.jsが報告するSHA-256も2回とも一致する');

  runTimezoneUmaskMatrix();
  testExtractionCleanupOnFailure();

  // package build(通常build・2回連続build・matrix4通り・matrix後の後始末build)を経ても、
  // このテスト開始時点から追加でtracked fileが変化していないことを再確認する。
  // (絶対的に「git statusが完全に綺麗であること」を求めるのではなく、このテスト実行が
  // 新たな変更を持ち込んでいないことだけを見る - 呼び出し時点で既にtracked fileへの
  // 未commit編集がある状態(開発中)でも誤検知しない)。
  const trackedFinal = trackedDiffNames();
  assert(trackedBefore === trackedFinal, '§6 package生成(通常build・再現性確認・TZ/umask matrixすべて含む)を経てもtracked fileの差分がテスト開始時点から変化しない');

  console.log(`\nzip=${result.zipPath} size=${result.size} sha256=${result.sha256}`);
  console.log(`${passCount} PASS, ${failures} FAIL`);
  if (failures > 0) { console.error('SOME TESTS FAILED'); process.exit(1); }
  console.log('ALL PASS');
}

// ---- §10 Finding 1: TZ x umask 決定性matrix ----
// 子プロセスでbuild_package.jsを再実行し、環境(TZ・umask)を変えてもZIP/manifest/SHA256SUMS/
// 展開結果がbit単位で一致することを検査する。umaskは呼び出し元プロセスに設定してから
// spawnすることで子プロセスへ継承させる(Unixのfork/exec仕様どおり)。
function runBuildInSubprocess(tz) {
  execFileSync(process.execPath, [BUILD_SCRIPT], {
    cwd: REPO_ROOT,
    env: { ...process.env, TZ: tz },
    stdio: 'pipe'
  });
}

function snapshotCurrentBuild(label) {
  const zipHash = sha256File(builder.ZIP_PATH);
  const zipSize = fs.statSync(builder.ZIP_PATH).size;
  const manifestText = fs.readFileSync(path.join(builder.STAGING, 'manifest.json'), 'utf8');
  const sumsText = fs.readFileSync(path.join(builder.STAGING, 'SHA256SUMS'), 'utf8');
  const extracted = extractZipAndHash(builder.ZIP_PATH, `matrix-${label}`);
  return { zipHash, zipSize, manifestText, sumsText, extractedFiles: extracted.files, extractedHashes: extracted.hashes };
}

function runTimezoneUmaskMatrix() {
  const combos = [
    { tz: 'UTC', umask: 0o022 },
    { tz: 'Asia/Tokyo', umask: 0o022 },
    { tz: 'UTC', umask: 0o002 },
    { tz: 'Asia/Tokyo', umask: 0o002 }
  ];
  const snapshots = [];
  const previousUmask = process.umask();
  try {
    for (const combo of combos) {
      process.umask(combo.umask);
      runBuildInSubprocess(combo.tz);
      const label = `${combo.tz.replace('/', '_')}-${combo.umask.toString(8).padStart(4, '0')}`;
      snapshots.push({ ...combo, label, ...snapshotCurrentBuild(label) });
    }
  } finally {
    process.umask(previousUmask);
  }

  const baseline = snapshots[0];
  for (let i = 1; i < snapshots.length; i++) {
    const s = snapshots[i];
    const pair = `TZ=${baseline.tz}/umask=${baseline.umask.toString(8)} vs TZ=${s.tz}/umask=${s.umask.toString(8)}`;
    assert(s.zipSize === baseline.zipSize, `§10 TZ/umask matrix: ZIP sizeが一致(${pair})`);
    assert(s.zipHash === baseline.zipHash, `§10 TZ/umask matrix: ZIP SHA-256が一致(${pair})`);
    assert(s.manifestText === baseline.manifestText, `§10 TZ/umask matrix: manifest.jsonの内容が一致(${pair})`);
    assert(s.sumsText === baseline.sumsText, `§10 TZ/umask matrix: SHA256SUMSの内容が一致(${pair})`);
    assert(JSON.stringify(s.extractedFiles) === JSON.stringify(baseline.extractedFiles), `§10 TZ/umask matrix: 展開後ファイル一覧が一致(${pair})`);
    assert(JSON.stringify(s.extractedHashes) === JSON.stringify(baseline.extractedHashes), `§10 TZ/umask matrix: 展開後各ファイルSHA-256が一致(${pair})`);
  }
  console.log('\nDeterministic Package Matrix:');
  for (const s of snapshots) {
    console.log(`  TZ=${s.tz} umask=${s.umask.toString(8).padStart(4, '0')} size=${s.zipSize} sha256=${s.zipHash}`);
  }

  // matrix実行後、通常環境(既定TZ/umask)のbuildへ戻し、以降の(このプロセス内で行う)確認が
  // 通常状態のZIP/stagingを見るようにする。
  builder.main();
}

// ---- §11 Finding 4: 失敗注入時のcleanup検査 ----
// 外部コマンド(unzip)がわざと失敗する状況(存在しないZIPパス)を注入し、
// (a) extractZipAndHash()が例外を投げる, (b) それでも一時ディレクトリが残らない、の両方を確認する。
function testExtractionCleanupOnFailure() {
  const root = tmpRoot();
  const before = new Set(fs.readdirSync(root).filter(n => n.startsWith('kb-anp1-')));

  const bogusZipPath = path.join(builder.PACKAGE_DIR, 'this-zip-does-not-exist.zip');
  let threw = false;
  try {
    extractZipAndHash(bogusZipPath, 'failure-injection');
  } catch (e) {
    threw = true;
  }
  assert(threw, '§11 失敗注入: 存在しないZIPを展開しようとするとextractZipAndHash()が例外を投げる(fail-closed)');

  const after = new Set(fs.readdirSync(root).filter(n => n.startsWith('kb-anp1-')));
  const leaked = [...after].filter(n => !before.has(n));
  assert(leaked.length === 0, `§11 失敗注入: 例外発生後も一時ディレクトリが残らない(try/finallyでcleanup済み。残存: ${JSON.stringify(leaked)})`);
}

main();

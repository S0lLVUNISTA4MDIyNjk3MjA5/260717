#!/usr/bin/env node
'use strict';
/*
 * v0.10.1-alpha Checkpoint 6: documentation/verification-evidence
 * consistency check.
 *
 * Scope: README.md, pdf_tool/KNOWN_LIMITATIONS.md,
 * excel_tool/KNOWN_LIMITATIONS.md, SMOKE_TEST_REPORT.md,
 * THREE_TOOL_COMPATIBILITY_REPORT.md. No product code changes here --
 * this checkpoint only touches documentation and adds verification
 * evidence (SMOKE_TEST_REPORT.md, this script). Then re-runs every prior
 * checkpoint's verification script plus the new smoke test as a full
 * regression.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const checks = [];
function check(name, cond, detail) { checks.push({ name, ok: !!cond, detail }); }
function readText(p) { return fs.readFileSync(p, 'utf8'); }

const DOCS = {
  'README.md': path.join(ROOT, 'README.md'),
  'pdf_tool/KNOWN_LIMITATIONS.md': path.join(ROOT, 'pdf_tool', 'KNOWN_LIMITATIONS.md'),
  'excel_tool/KNOWN_LIMITATIONS.md': path.join(ROOT, 'excel_tool', 'KNOWN_LIMITATIONS.md'),
  'SMOKE_TEST_REPORT.md': path.join(ROOT, 'SMOKE_TEST_REPORT.md'),
  'THREE_TOOL_COMPATIBILITY_REPORT.md': path.join(ROOT, 'THREE_TOOL_COMPATIBILITY_REPORT.md'),
};

function docExistenceChecks() {
  for (const [label, p] of Object.entries(DOCS)) {
    check(`${label} が存在する`, fs.existsSync(p));
  }
}

// ── 存在しない文書参照: 0件 ──
// 各.md内の `foo.md`/`foo.json`/`foo.py`/`foo.js` 形式のインラインコード参照が、
// 実際にROOT配下(相対パス解決)に存在することを確認する。
function danglingReferenceChecks() {
  const pattern = /`([A-Za-z0-9_.\/-]+\.(?:md|json|py|js))`/g;
  const unresolved = [];
  for (const [label, p] of Object.entries(DOCS)) {
    if (!fs.existsSync(p)) continue;
    const text = readText(p);
    let m;
    while ((m = pattern.exec(text))) {
      const ref = m[1];
      // vendor/VENDOR_NOTICE.md 等、既存の他チェックポイントで検証済みの
      // vendor同梱物や、明らかにコード内識別子(拡張子だけ一致した誤検出)は対象外。
      if (ref.includes('${') || ref.startsWith('./vendor') || ref.includes('/vendor/')) continue;
      const candidates = [
        path.join(path.dirname(p), ref),
        path.join(ROOT, ref),
        path.join(ROOT, 'pdf_tool', ref),
        path.join(ROOT, 'excel_tool', ref),
        // quantity_sidecar_binding_core.js etc. are the compare-tool's own
        // reference files, kept as a session-local verification-only copy
        // one level above this handoff directory (not part of the
        // distributed ZIP) -- see PROVENANCE.md there.
        path.join(ROOT, '..', '_reference_binding_core', ref),
      ];
      if (!candidates.some(c => fs.existsSync(c))) unresolved.push(`${label}: \`${ref}\``);
    }
  }
  check('存在しない文書参照: 0件', unresolved.length === 0, unresolved);
}

// ── 修正済み不具合を現行制約として記述: 0件 ──
// 各バグの特徴的な語句が、"Fixed in v0.10.1-alpha"見出しの区間の外側
// (=現行の制約であるかのように)出現していないことを確認する。
const FIXED_BUG_PHRASES = [
  'Excel quantity sidecar未実装',
  'PDF sidecar.*source_mismatch',
  'AI入力JSON生成不能',
  'AI確認情報.*欠落',
  'trace_textへのAI',
];
function sectionsOutsideFixedHeading(text) {
  const lines = text.split('\n');
  const outside = [];
  let inFixedSection = false;
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      inFixedSection = /Fixed in v0\.10\.1-alpha/.test(line);
      continue;
    }
    if (!inFixedSection) outside.push(line);
  }
  return outside.join('\n');
}
function fixedBugAsCurrentLimitationChecks() {
  // Scoped to the two KNOWN_LIMITATIONS.md files only -- these are the
  // documents whose job is literally "list current constraints", so a
  // fixed-bug phrase appearing there (outside the "Fixed in v0.10.1-alpha"
  // section) would misrepresent it as still outstanding. README.md's own
  // "今回の変更" changelog section and THREE_TOOL_COMPATIBILITY_REPORT.md's
  // "前回からの変化" before/after table both legitimately discuss past
  // bugs in explicitly historical/changelog framing, not as current
  // constraints, so they are intentionally not scanned here.
  const SCOPE = ['pdf_tool/KNOWN_LIMITATIONS.md', 'excel_tool/KNOWN_LIMITATIONS.md'];
  const offenders = [];
  for (const label of SCOPE) {
    const p = DOCS[label];
    if (!fs.existsSync(p)) continue;
    const text = readText(p);
    const outsideText = sectionsOutsideFixedHeading(text);
    for (const phraseSrc of FIXED_BUG_PHRASES) {
      const re = new RegExp(phraseSrc);
      if (re.test(outsideText)) offenders.push(`${label}: matched /${phraseSrc}/ outside "Fixed in v0.10.1-alpha" section`);
    }
  }
  check('修正済み不具合を現行制約として記述: 0件(KNOWN_LIMITATIONS.md 2件を対象)', offenders.length === 0, offenders);
}

// ── 版数矛盾・vocabulary identity矛盾: 0件 ──
// 履歴説明(明示的な "簡易レビュー時点"比較表・"Fixed in"節・既知の2件のコメント行)は
// 許容する。それ以外での 0.1.0-alpha/0.8.0-alpha/0.10.0-alpha/spec-domain-ja の
// 出現はすべて矛盾として扱う。
const FORBIDDEN_VERSION_STRINGS = ['0.1.0-alpha', '0.8.0-alpha', '0.10.0-alpha'];
const ALLOWED_HISTORICAL_LINE_MARKERS = [
  '簡易レビュー時点', // THREE_TOOL_COMPATIBILITY_REPORT.mdの比較表(明示的に「前回」の値と分かる行)
  'Fixed in v0.10.1-alpha',
];
function versionAndVocabularyContradictionChecks() {
  const versionOffenders = [];
  const vocabOffenders = [];
  for (const [label, p] of Object.entries(DOCS)) {
    if (!fs.existsSync(p)) continue;
    const lines = readText(p).split('\n');
    lines.forEach((line, i) => {
      const isAllowedHistorical = ALLOWED_HISTORICAL_LINE_MARKERS.some(m => line.includes(m))
        || (i > 0 && lines[i - 1].includes('簡易レビュー時点'));
      for (const bad of FORBIDDEN_VERSION_STRINGS) {
        if (line.includes(bad) && !isAllowedHistorical) versionOffenders.push(`${label}:${i + 1}: ${line.trim()}`);
      }
      if (line.includes('spec-domain-ja') && !isAllowedHistorical) vocabOffenders.push(`${label}:${i + 1}: ${line.trim()}`);
    });
  }
  check('版数矛盾: 0件(0.1.0-alpha/0.8.0-alpha/0.10.0-alphaが現行値として残っていない)', versionOffenders.length === 0, versionOffenders);
  check('vocabulary identity矛盾: 0件(spec-domain-jaが現行値として残っていない)', vocabOffenders.length === 0, vocabOffenders);
}

// ── README/KNOWN_LIMITATIONSが現行実装と一致(必須トピックを含む) ──
function implementationAlignmentChecks() {
  const readme = readText(DOCS['README.md']);
  const REQUIRED_README_TOPICS = [
    'v0.10.1-alpha', 'AI入力JSON', 'AI回答取込', 'trace-domain-ja', '1.0.0', '限定評価版',
  ];
  for (const topic of REQUIRED_README_TOPICS) {
    check(`README.mdが必須トピック"${topic}"を含む`, readme.includes(topic));
  }
  check('README.mdがPDF/Excel双方のquantity sidecarに言及', /PDF.*quantity sidecar|quantity sidecar.*PDF/s.test(readme) || (readme.includes('quantity sidecar') && readme.includes('母体ツールに元々あった機能')));

  const pdfKl = readText(DOCS['pdf_tool/KNOWN_LIMITATIONS.md']);
  const excelKl = readText(DOCS['excel_tool/KNOWN_LIMITATIONS.md']);
  check('pdf_tool/KNOWN_LIMITATIONS.mdの見出しがv0.10.1-alpha', pdfKl.split('\n')[0].includes('v0.10.1-alpha'));
  check('excel_tool/KNOWN_LIMITATIONS.mdの見出しがv0.10.1-alpha', excelKl.split('\n')[0].includes('v0.10.1-alpha'));
  check('pdf_tool/KNOWN_LIMITATIONS.mdがtrace-domain-jaに言及', pdfKl.includes('trace-domain-ja') || pdfKl.includes('shared/tag_vocabulary.json'));
  check('excel_tool/KNOWN_LIMITATIONS.mdがtrace-domain-jaに言及', excelKl.includes('trace-domain-ja') || excelKl.includes('shared/tag_vocabulary.json'));

  // "外部networkリクエスト0件"のような集約表現が、attempt(試行)とsuccess(成立)を
  // 混同したまま提示されていないこと -- SMOKE_TEST_REPORT.mdは両者を別の行として
  // 明記しなければならない(Checkpoint 6 REQUEST CHANGESで指摘された点)。
  const smoke = readText(DOCS['SMOKE_TEST_REPORT.md']);
  check('SMOKE_TEST_REPORT.mdが"external network attempts"と"successful external network"を別項目として明記',
    /external network attempts/.test(smoke) && /successful external network/.test(smoke));
  check('SMOKE_TEST_REPORT.mdが想定外/想定内のconsole errorを区別して明記',
    /console error（想定外/.test(smoke) && /console error（想定内/.test(smoke));
  // PR #7 Final Release Review指摘: git commitはワークツリーの状態次第で曖昧になりうるため、
  // 製品HTMLファイル自体のSHA-256を主たる根拠として明記しなければならない。
  check('SMOKE_TEST_REPORT.mdがPDF/Excel製品HTMLのSHA-256を明記',
    /PDF HTML:.*SHA-256 `[0-9a-f]{64}`/.test(smoke) && /Excel HTML:.*SHA-256 `[0-9a-f]{64}`/.test(smoke));
  check('SMOKE_TEST_REPORT.mdが製品HTML対象commitを参考情報として明記', /製品HTML対象commit\(参考情報\): `[0-9a-f]{7,40}`/.test(smoke));
}

// ── THREE_TOOL_COMPATIBILITY_REPORT.mdが「完全互換」を断定していない ──
function noOverclaimChecks() {
  const report = readText(DOCS['THREE_TOOL_COMPATIBILITY_REPORT.md']);
  const NEGATION_MARKERS = ['断定', '宣言するものではありません', 'ではありません'];
  const linesWithClaim = report.split('\n').filter(l => l.includes('完全互換'));
  const unnegatedClaims = linesWithClaim.filter(l => !NEGATION_MARKERS.some(m => l.includes(m)));
  check('THREE_TOOL_COMPATIBILITY_REPORT.mdが"完全互換"を断定していない', unnegatedClaims.length === 0, unnegatedClaims);
  check('THREE_TOOL_COMPATIBILITY_REPORT.mdが照合ツール側の未実装事項(AI metadata UI/vocabulary診断)を明記', report.includes('未実装') && report.includes('AI metadata') && report.includes('vocabulary'));
}

function runRegressionSuites() {
  const suites = [
    'pdf_checkpoint1_verification.js',
    'excel_checkpoint2_verification.js',
    'excel_checkpoint3_verification.js',
    'shared_tag_vocabulary_verification.js',
    'checkpoint5_version_harmonization_verification.js',
    'checkpoint5b_verification.js',
    'checkpoint6_smoke_test.js',
  ];
  for (const suite of suites) {
    const suitePath = path.join(ROOT, suite);
    let output = '', ok = false;
    try {
      output = execFileSync('node', [suitePath], { cwd: ROOT, timeout: 300000, encoding: 'utf8', env: process.env });
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
  console.log('=== Checkpoint 6 (文書・検証証拠整備) 検証結果 ===');
  for (const c of checks) {
    console.log(`[${c.ok ? 'PASS' : 'FAIL'}] ${c.name}${c.detail !== undefined ? ` :: ${JSON.stringify(c.detail)}` : ''}`);
  }
  console.log(`\n合計 ${total}件中 ${passed}件成功`);
  if (passed !== total) process.exitCode = 1;
}

function main() {
  docExistenceChecks();
  danglingReferenceChecks();
  fixedBugAsCurrentLimitationChecks();
  versionAndVocabularyContradictionChecks();
  implementationAlignmentChecks();
  noOverclaimChecks();
  runRegressionSuites();
  report();
}

main();

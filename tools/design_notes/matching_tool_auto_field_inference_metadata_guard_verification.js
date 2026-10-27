#!/usr/bin/env node
/* Checkpoint L3-1 (Canonical Matching Input + Safe Auto Field Mapping).
 *
 * Real Chromium browser-closure regression test for
 * tools/json_ab_trace_matching_tool_v12.1.15.html - proves the reproduced known failure (constant
 * technical metadata field `id_scheme_version` auto-selected as a matching key, producing a
 * false-positive N*M match cross-product) is permanently prevented by the L3-1 fix
 * (tools/canonical_matching_field_registry_core.js wired into defaultKeyPairs()).
 *
 * This script can run in two modes:
 *   node matching_tool_auto_field_inference_metadata_guard_verification.js
 *     -> asserts the FIXED (current, post-L3-1) HTML never reproduces the defect. This is the
 *        permanent regression test - it must stay green.
 *   node matching_tool_auto_field_inference_metadata_guard_verification.js --html <path> --expect-bug
 *     -> runs the same scenarios against an arbitrary HTML file (e.g. a pre-L3-1 copy checked out
 *        from f7f5d624) and asserts the defect IS present, to document the pre-fix reproduction.
 *        Used once, interactively, to freeze evidence of the original failure - not part of the
 *        normal `node ...verification.js` regression run.
 *
 * Three scenarios, matching L3-1 task §1/§15 and L3-1-FINAL task §2:
 *   A. Real-world reproduction: the SAME real "照合用JSON" trace file (produced by the actual PDF
 *      tool, via Playwright, from a real generated PDF - see the architecture assessment's
 *      cross-format experiment) loaded on both System and PLM sides. This is the literal scenario
 *      that originally produced the id_scheme_version false-positive cross-product.
 *   B. General defect-class regression (task §15): synthetic records where every business value
 *      differs (Pump/Valve/Sensor vs Motor/Breaker/Controller) but `id_scheme_version` is identical
 *      on every record on both sides. Proves the fix is not a literal-field-name patch but closes
 *      the whole defect class (any constant/near-constant technical field, not just this one name).
 *   C. Hunk-4 fail-closed branch closure (L3-1-FINAL task §2): both sides load successfully but
 *      EVERY field on both sides is technical/identity/provenance metadata (no trace_text/
 *      trace_title/description-shaped field at all) - the one input shape where
 *      suggestSafeAutoFieldPairing() has no eligible field on either side and defaultKeyPairs()
 *      genuinely returns an empty array, which is the only way
 *      reconcileKeyPairsForLoadedInput()'s new fail-closed status-message branch (Hunk 4) can
 *      execute at all. Scenarios A and B never reach this branch (both always have a usable
 *      trace_text/trace_title field), which is why this scenario exists as a separate, dedicated
 *      case rather than an assertion added to A or B.
 *
 * Usage: node matching_tool_auto_field_inference_metadata_guard_verification.js [--html <path>] [--expect-bug]
 *
 * STATUS AS OF THIS CHECKPOINT (L3-1): tools/json_ab_trace_matching_tool_v12.1.15.html is under a
 * strict, code-enforced exact-hunk protected-file freeze (see
 * tools/knowledge_builder/verification/private_dictionary_p2a4_authorized_matching_diff_guard.js -
 * ANY diff against the file outside its hardcoded authorized-hunks list fails that guard,
 * regardless of size). Wiring canonical_matching_field_registry_core.js into defaultKeyPairs()
 * requires extending that authorized-hunks list, which is a governance decision for a human to
 * make, not something this session may do unilaterally. The wiring was therefore validated against
 * a staged, NOT-committed copy of the file during this checkpoint (evidence in the L3-1 checkpoint
 * report) and then reverted out of the tracked file. Until that governance approval lands and the
 * real wiring is applied, this script's default (no-args) run reports INCOMPLETE rather than a
 * false PASS or FAIL - it is not silently skipped, and it is not claimed to be green.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_HTML = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const args = process.argv.slice(2);
const htmlArgIdx = args.indexOf('--html');
const HTML_PATH = htmlArgIdx !== -1 ? args[htmlArgIdx + 1] : DEFAULT_HTML;
const EXPECT_BUG = args.includes('--expect-bug');

const checks = [];
function check(name, condition, detail) { checks.push({ name, ok: !!condition, detail }); }

// Scenario A fixtures: real trace JSON produced by the actual PDF tool (Playwright-driven, real
// Chromium, real reportlab-generated PDF - see the L2 architecture assessment's cross-format
// experiment). Re-embedded here verbatim so this regression test is self-contained and does not
// depend on an external scratch path.
const REAL_PDF_TRACE = {
  file_name: 'xfmt_perf_verification.pdf', chapter_number: 'TRACE', chapter_title: '性能検証',
  trace_format: 'chapter-section-trace-v1', schema_version: '1.2',
  source: { document_id: 'doc-1', document_sha256: 'x'.repeat(64), id_scheme_version: 'stable-uid-id-v2' },
  _trace_records: [
    { trace_id: 'blk-a1', parent_id: 'sec-1', trace_title: '本節', trace_text: '本節は、性能検証試験の結果一覧を示す。', trace_category: 'text', trace_key_text: '性能検証 3.1 検証結果一覧', section_title: '検証結果一覧', source_section_id: 'sec-1', block_type: 'paragraph', source_page: 1, id_scheme_version: 'stable-uid-id-v2', review_status: 'unreviewed' },
    { trace_id: 'blk-a2', parent_id: 'sec-1', trace_title: '耐圧試験', trace_text: '耐圧試験 1.50MPa 1.52MPa', trace_category: 'table_row', trace_key_text: '性能検証 3.1 検証結果一覧 耐圧試験', section_title: '検証結果一覧', source_section_id: 'sec-1', block_type: 'table_row', source_page: 1, id_scheme_version: 'stable-uid-id-v2', review_status: 'unreviewed' },
    { trace_id: 'blk-a3', parent_id: 'sec-1', trace_title: '絶縁抵抗', trace_text: '絶縁抵抗 10MΩ以上 12MΩ', trace_category: 'table_row', trace_key_text: '性能検証 3.1 検証結果一覧 絶縁抵抗', section_title: '検証結果一覧', source_section_id: 'sec-1', block_type: 'table_row', source_page: 1, id_scheme_version: 'stable-uid-id-v2', review_status: 'unreviewed' },
    { trace_id: 'blk-a4', parent_id: 'sec-1', trace_title: '振動試験', trace_text: '振動試験 5G以下 3G', trace_category: 'table_row', trace_key_text: '性能検証 3.1 検証結果一覧 振動試験', section_title: '検証結果一覧', source_section_id: 'sec-1', block_type: 'table_row', source_page: 1, id_scheme_version: 'stable-uid-id-v2', review_status: 'unreviewed' },
    { trace_id: 'blk-a5', parent_id: 'sec-1', trace_title: '騒音レベル', trace_text: '騒音レベル 65dB以下 60dB', trace_category: 'table_row', trace_key_text: '性能検証 3.1 検証結果一覧 騒音レベル', section_title: '検証結果一覧', source_section_id: 'sec-1', block_type: 'table_row', source_page: 1, id_scheme_version: 'stable-uid-id-v2', review_status: 'unreviewed' },
  ],
};

// Scenario B fixtures: task §15's worked example almost verbatim - all business terms differ,
// id_scheme_version identical on every record on both sides.
function metadataCrossProductFixture(side) {
  const terms = side === 'sys' ? ['Pump', 'Valve', 'Sensor'] : ['Motor', 'Breaker', 'Controller'];
  return {
    trace_format: 'chapter-section-trace-v1', schema_version: '1.2',
    _trace_records: terms.map((t, i) => ({
      trace_id: `${side}-${i}`, parent_id: 'sec-1', trace_title: t, trace_text: `${t} component record ${i}`,
      trace_category: 'table_row', trace_key_text: `doc sec ${t}`, section_title: 'sec',
      source_section_id: 'sec-1', block_type: 'table_row', id_scheme_version: 'stable-uid-id-v2',
      review_status: 'unreviewed',
    })),
  };
}

// Scenario C fixture: every field on every record, both sides, is technical/identity/provenance
// metadata - no trace_text/trace_title/description-shaped field anywhere. This is the one shape
// that leaves ZERO auto-eligible fields on either side, so suggestSafeAutoFieldPairing() must fail
// closed and defaultKeyPairs() must return an empty array (the only way the Hunk-4 branch fires).
function metadataOnlyFixture(side) {
  return {
    trace_format: 'chapter-section-trace-v1', schema_version: '1.2',
    _trace_records: [0, 1, 2].map(i => ({
      trace_id: `${side}-meta-${i}`, parent_id: 'sec-1', stable_key: `${side}-key-${i}`,
      content_hash: `hash-${side}-${i}`, block_type: 'table_row', trace_category: 'table_row',
      source_section_id: 'sec-1', id_scheme_version: 'stable-uid-id-v2', schema_version: '1.2',
      review_status: 'unreviewed', ai_reviewed: false,
    })),
  };
}

async function writeTmpJson(obj, name) {
  const p = path.join('/tmp', name);
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

async function loadAndMatch(page, sysPath, plmPath) {
  await page.goto('file://' + HTML_PATH);
  await page.waitForTimeout(400);
  await page.setInputFiles('#sysFile', sysPath);
  await page.setInputFiles('#plmFile', plmPath);
  await page.waitForTimeout(200);
  await page.waitForFunction(() => !document.getElementById('loadBtn').disabled, { timeout: 10000 });
  await page.evaluate(() => document.getElementById('loadBtn').click());
  await page.waitForTimeout(1500);

  return page.evaluate(() => {
    const keyPairs = (typeof matchLogic !== 'undefined' && matchLogic.keyPairs) ? JSON.parse(JSON.stringify(matchLogic.keyPairs)) : [];
    const rows = (typeof traceMatrixRows !== 'undefined' && traceMatrixRows) ? traceMatrixRows.map(r => {
      const a = r._autoRow || r;
      return { A_ID: a.A_ID, B_ID: a.B_ID, confidence: a.信頼度, method: a.方式, basis: a.根拠, classification: a.分類 };
    }) : [];
    const diag = (typeof lastAutoFieldPairingDiagnostics !== 'undefined') ? lastAutoFieldPairingDiagnostics : null;
    const reconcileNotice = (typeof keyPairReconcileNotice !== 'undefined') ? keyPairReconcileNotice : null;
    return { keyPairs, rows, diag, reconcileNotice };
  });
}

async function main() {
  console.log('HTML under test:', HTML_PATH, EXPECT_BUG ? '(expecting pre-fix bug)' : '(expecting fixed behavior)');
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });

  if (!EXPECT_BUG) {
    // The fix can only be observed if the target HTML actually loads
    // canonical_matching_field_registry_core.js. As of this checkpoint that wiring is staged but
    // NOT applied to the tracked, protected-file-frozen HTML pending governance approval to extend
    // its authorized-hunks allowlist (see the file header comment above). Detect that honestly
    // instead of either a false PASS (skipping the check) or a false FAIL (claiming the guard is
    // broken when it was simply never wired in).
    const probePage = await browser.newPage();
    await probePage.goto('file://' + HTML_PATH);
    await probePage.waitForTimeout(300);
    const wired = await probePage.evaluate(() => !!globalThis.CanonicalMatchingFieldRegistry);
    await probePage.close();
    if (!wired) {
      console.log('\nINCOMPLETE: CanonicalMatchingFieldRegistry is not loaded by', HTML_PATH, '- the L3-1 wiring is staged but not yet applied to this protected file pending governance approval (see file header). This is a HOLD, not a PASS or a FAIL.');
      await browser.close();
      process.exit(1);
    }
  }

  // ---- Scenario A: real PDF-tool trace JSON, same file on both sides -------------------------
  {
    const page = await browser.newPage();
    page.on('dialog', async d => { await d.accept(); });
    const p = await writeTmpJson(REAL_PDF_TRACE, 'l3_1_scenario_a.json');
    const result = await loadAndMatch(page, p, p);
    const idSchemeUsed = result.keyPairs.some(kp => kp.sysField === 'id_scheme_version' || kp.plmField === 'id_scheme_version');
    const idSchemeMatchRows = result.rows.filter(r => (r.basis || '').includes('id_scheme_version'));
    console.log('Scenario A keyPairs:', JSON.stringify(result.keyPairs));
    console.log('Scenario A id_scheme_version-derived match rows:', idSchemeMatchRows.length, 'of', result.rows.length, 'total rows');

    if (EXPECT_BUG) {
      check('A-pre-fix. id_scheme_version selected as a key pair (bug present)', idSchemeUsed === true);
      check('A-pre-fix. false-positive cross-product reproduced (>0 metadata-derived match rows)', idSchemeMatchRows.length > 0, `${idSchemeMatchRows.length} rows`);
    } else {
      check('A. id_scheme_version never selected as an automatic key pair', idSchemeUsed === false, JSON.stringify(result.keyPairs));
      check('A. zero id_scheme_version-derived match rows', idSchemeMatchRows.length === 0, `${idSchemeMatchRows.length} rows`);
    }
    await page.close();
  }

  // ---- Scenario B: task §15 metadata cross-product regression ----------------------------------
  {
    const page = await browser.newPage();
    page.on('dialog', async d => { await d.accept(); });
    const sysPath = await writeTmpJson(metadataCrossProductFixture('sys'), 'l3_1_scenario_b_sys.json');
    const plmPath = await writeTmpJson(metadataCrossProductFixture('plm'), 'l3_1_scenario_b_plm.json');
    const result = await loadAndMatch(page, sysPath, plmPath);
    const idSchemeUsed = result.keyPairs.some(kp => kp.sysField === 'id_scheme_version' || kp.plmField === 'id_scheme_version');
    const idSchemeMatchRows = result.rows.filter(r => (r.basis || '').includes('id_scheme_version'));
    console.log('Scenario B keyPairs:', JSON.stringify(result.keyPairs));
    console.log('Scenario B id_scheme_version-derived match rows:', idSchemeMatchRows.length, 'of', result.rows.length, 'total rows');
    console.log('Scenario B failedClosed diagnostics:', result.diag ? JSON.stringify({ failedClosed: result.diag.failedClosed, reason: result.diag.reason }) : 'n/a (legacy fallback path - registry script missing?)');

    if (EXPECT_BUG) {
      check('B-pre-fix. id_scheme_version selected despite every business term differing (bug present)', idSchemeUsed === true);
      check('B-pre-fix. metadata-derived match count > 0', idSchemeMatchRows.length > 0, `${idSchemeMatchRows.length} rows`);
    } else {
      check('B. id_scheme_version never selected despite every business term differing', idSchemeUsed === false, JSON.stringify(result.keyPairs));
      check('B. metadata-derived business match count = 0 (task §15 requirement)', idSchemeMatchRows.length === 0, `${idSchemeMatchRows.length} rows`);
      // Real business term/description fields (trace_title / trace_text) still differ across every
      // record - confirm the safe suggester found a legitimate business field pair instead of
      // simply failing closed on everything (i.e. the guard removes the bad pair without breaking
      // real matching for records that do share genuine content, per §16 elsewhere in this
      // checkpoint; here we only need to confirm SOME non-metadata pair was offered).
      const hasNonMetadataPair = result.keyPairs.some(kp => kp.sysField !== 'id_scheme_version' && kp.plmField !== 'id_scheme_version');
      check('B. a non-metadata field pair was still offered (guard does not just blank everything)', hasNonMetadataPair, JSON.stringify(result.keyPairs));
    }
    await page.close();
  }

  // ---- Scenario C: Hunk-4 fail-closed branch closure (L3-1-FINAL task §2) ----------------------
  if (!EXPECT_BUG) {
    const page = await browser.newPage();
    page.on('dialog', async d => { await d.accept(); });
    const sysPath = await writeTmpJson(metadataOnlyFixture('sys'), 'l3_1_scenario_c_sys.json');
    const plmPath = await writeTmpJson(metadataOnlyFixture('plm'), 'l3_1_scenario_c_plm.json');
    const result = await loadAndMatch(page, sysPath, plmPath);
    console.log('Scenario C keyPairs:', JSON.stringify(result.keyPairs));
    console.log('Scenario C reconcileNotice:', JSON.stringify(result.reconcileNotice));
    console.log('Scenario C rows:', JSON.stringify(result.rows));
    console.log('Scenario C diagnostics:', result.diag ? JSON.stringify({ failedClosed: result.diag.failedClosed, reason: result.diag.reason }) : 'n/a');

    // A. keyPairs.length === 0
    check('C-A. auto keyPairs is empty (no field pair was inferred at all)', result.keyPairs.length === 0, JSON.stringify(result.keyPairs));

    // B. No technical/metadata pair is selected.
    const METADATA_FIELD_NAMES = ['trace_id', 'parent_id', 'stable_key', 'content_hash', 'block_type', 'trace_category', 'source_section_id', 'id_scheme_version', 'schema_version', 'review_status', 'ai_reviewed'];
    const anyMetadataPair = result.keyPairs.some(kp => METADATA_FIELD_NAMES.includes(kp.sysField) || METADATA_FIELD_NAMES.includes(kp.plmField));
    check('C-B. no technical/metadata field pair selected', anyMetadataPair === false, JSON.stringify(result.keyPairs));

    // C. No legacy heuristic silently substitutes an unsafe pair (equivalent to A given the module
    // is confirmed loaded - see the wired-check earlier in main() - so an empty result here can only
    // mean the safe suggester itself failed closed, never that it was skipped in favor of the legacy
    // path, which would have produced SOME pair given scoreFieldForRole() never returns nothing for
    // a non-empty field set).
    check('C-C. legacy heuristic did not silently substitute an unsafe pair (registry diagnostics confirm the safe path ran and failed closed)', !!result.diag && result.diag.failedClosed === true, result.diag ? JSON.stringify(result.diag.reason) : 'no diagnostics recorded');

    // D. The Human-facing status message clearly tells the user that no safe automatic matching
    // columns were found and manual configuration is required.
    const expectedNotice = '安全に自動推定できる照合列が見つかりませんでした。「＋ 照合ペアを追加」から手動で設定してください。';
    check('C-D. human-facing status message explicitly states no safe auto mapping was found and manual configuration is required', result.reconcileNotice === expectedNotice, JSON.stringify(result.reconcileNotice));

    // E. No match rows are generated merely from technical/common metadata.
    const confirmedMatchRows = result.rows.filter(r => r.classification === '対応あり');
    check('C-E. zero confirmed match rows (classification 対応あり) generated from metadata-only records', confirmedMatchRows.length === 0, `${confirmedMatchRows.length} of ${result.rows.length} total rows`);

    await page.close();
  }

  await browser.close();

  let pass = 0, fail = 0;
  checks.forEach(c => {
    const status = c.ok ? 'PASS' : 'FAIL';
    if (c.ok) pass++; else fail++;
    console.log(`[${status}] ${c.name}${c.detail ? ' :: ' + c.detail : ''}`);
  });
  console.log(`\n${pass} passed, ${fail} failed, ${checks.length} total`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });

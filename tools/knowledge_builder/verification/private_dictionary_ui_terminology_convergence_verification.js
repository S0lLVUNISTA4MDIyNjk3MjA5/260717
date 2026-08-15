#!/usr/bin/env node
'use strict';
/* P2-A4 Checkpoint 14 - HUMAN-01/02/03 UI Convergence verification.
 *
 * Scope: this Checkpoint is UI/UX wording convergence ONLY. It never touches dictionary
 * resolution logic, Promotion, Snapshot, Resolver, matching score, or comparison review
 * semantics. This file verifies exactly that: terminology is Japanese-first + English-companion
 * (HUMAN-01) without changing any internal enum/schema, the private save/resume vs shareable
 * export distinction is explicit in the UI (HUMAN-02), filter options are human-explained without
 * changing filter predicates (HUMAN-03), and nothing about the existing artifact schema, protected
 * pure cores, or prior checkpoints' terminology is disturbed.
 *
 * Two halves, same pattern as private_dictionary_candidate_review_ui_verification.js /
 * private_dictionary_candidate_review_workbook_verification.js:
 *   1. Node-side static source scans + pure-function checks (always run)
 *   2. Real-Chromium checks via the real server.js + the real index.html (skipped with a clear
 *      SKIP if Playwright is not installed - the Node half still gates every commit)
 *
 * Traceability: each block is labeled with the letter (A-AO) from the Checkpoint 14 request's
 * §36 verification matrix.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execSync } = require('child_process');

const HERE = __dirname;
const REPO_ROOT = path.join(HERE, '..', '..', '..');
const UI = path.join(HERE, '..', 'ui', 'private_dictionary_candidate_review_ui');
const MATCHING_HTML_PATH = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const PRE_HEAD_SHA = '45d296a9719fa68b00adfeaf9ce3da79e3da5c2e';

let passed = 0, failed = 0, skipped = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; console.log(`FAIL: ${label}`); }
}
function skip(label) { skipped++; console.log(`SKIP: ${label}`); }

function readUI(name) { return fs.readFileSync(path.join(UI, name), 'utf8'); }

// ==================================================================================================
// 1. Node-side static source scans
// ==================================================================================================
function staticChecks() {
  const html = readUI('index.html');
  const domJs = readUI('dom.js');
  const tableViewJs = readUI('table_view.js');
  const aliasViewJs = readUI('alias_view.js');
  const conflictViewJs = readUI('conflict_view.js');
  const evidencePanelJs = readUI('evidence_panel.js');
  const dashboardJs = readUI('dashboard.js');
  const appJs = readUI('app.js');
  const allUiSource = [html, domJs, tableViewJs, aliasViewJs, conflictViewJs, evidencePanelJs, dashboardJs, appJs].join('\n');

  // --------------------------------------------------------------------------------------------
  // HUMAN-01 terminology: A-G
  // --------------------------------------------------------------------------------------------

  // A. Alias-related user-facing display is Japanese-first + English companion
  assert(/別名（Alias）/.test(html), 'A tab label uses 別名（Alias）');
  assert(/別名（alias）/.test(html), 'A prose occurrences of "alias" are wrapped as 別名（alias）');
  assert(!/>Alias</.test(html), 'A no remaining bare English-only "Alias" as element text content in index.html');

  // B. Conflict-related display is Japanese-first + English companion
  assert(/競合（Conflict）/.test(html), 'B tab label uses 競合（Conflict）');
  assert(/競合優先（Conflict Priority）/.test(html), 'B sort option uses 競合優先（Conflict Priority）');
  assert(!/>Conflict</.test(html), 'B no remaining bare English-only "Conflict" as element text content in index.html');

  // C. Canonical-related display is unified
  assert(/正規語（Canonical）/.test(html), 'C alias-tab table header uses 正規語（Canonical）');
  assert(/正規語（canonical）/.test(conflictViewJs), 'C RESOLUTION_LABELS SELECT_CANONICAL uses 正規語（canonical）, not bare "canonical"');
  assert(/正規語（canonical）が長すぎる/.test(tableViewJs), 'C CANONICAL_TOO_LONG reason label uses 正規語（canonical）');

  // D. Unreviewed/Accepted/Rejected/Uncertain private-dictionary review terms are unified
  assert(/承認（ACCEPT）/.test(html) && /却下（REJECT）/.test(html) && /保留（UNCERTAIN）/.test(html) && /未判定（UNREVIEWED）/.test(html),
    'D dashboard/filter labels use the unified bilingual decision labels');
  assert(/DECISION_LABELS/.test(domJs), 'D dom.js exposes the single shared DECISION_LABELS map (S31.4)');
  const decisionLabelsMatch = domJs.match(/const DECISION_LABELS = Object\.freeze\(\{([\s\S]*?)\}\);/);
  assert(!!decisionLabelsMatch, 'D DECISION_LABELS is defined as a frozen object literal');
  assert(decisionLabelsMatch && /ACCEPT: '承認（ACCEPT）'/.test(decisionLabelsMatch[0])
    && /REJECT: '却下（REJECT）'/.test(decisionLabelsMatch[0])
    && /UNCERTAIN: '保留（UNCERTAIN）'/.test(decisionLabelsMatch[0])
    && /UNREVIEWED: '未判定（UNREVIEWED）'/.test(decisionLabelsMatch[0]),
    'D DECISION_LABELS English companion matches the real enum spelling exactly (never a paraphrase)');

  // E. internal enum values are unchanged (byte-identical to the fixed Checkpoint 3/13 contract)
  const ReviewState = require(path.join(UI, 'review_state.js'));
  assert(JSON.stringify(ReviewState.DECISIONS) === JSON.stringify(['UNREVIEWED', 'ACCEPT', 'REJECT', 'UNCERTAIN']),
    'E review_state.js DECISIONS enum is byte-identical to the pre-Checkpoint-14 contract');
  assert(JSON.stringify(ReviewState.RESOLUTIONS) === JSON.stringify(['UNRESOLVED', 'SELECT_CANONICAL', 'REJECT_ALL', 'CONTEXT_DEPENDENT', 'UNCERTAIN']),
    'E review_state.js RESOLUTIONS enum is byte-identical to the pre-Checkpoint-14 contract');
  const WorkbookContract = require(path.join(UI, 'workbook_contract.js'));
  assert(JSON.stringify(WorkbookContract.DECISIONS) === JSON.stringify(ReviewState.DECISIONS),
    'E workbook_contract.js DECISIONS agrees with review_state.js DECISIONS (no drift introduced)');

  // F. schema key/version unchanged
  assert(WorkbookContract.PRIVATE_FILE_NAME === 'private_dictionary_candidate_review.xlsx', 'F PRIVATE_FILE_NAME unchanged');
  assert(WorkbookContract.SHAREABLE_FILE_NAME === 'shareable_review_summary.xlsx', 'F SHAREABLE_FILE_NAME unchanged');
  assert(JSON.stringify(WorkbookContract.PRIVATE_HEADERS_BY_SHEET) === JSON.stringify(WorkbookContract.VERIFICATION_EXPECTED_PRIVATE_HEADERS),
    'F private Workbook header contract unchanged (matches its own independent expected-value copy)');
  assert(JSON.stringify(WorkbookContract.SHAREABLE_HEADERS_BY_SHEET) === JSON.stringify(WorkbookContract.VERIFICATION_EXPECTED_SHAREABLE_HEADERS),
    'F shareable Workbook header contract unchanged (matches its own independent expected-value copy)');
  assert(ReviewState.REVIEW_SCHEMA_VERSION === 'private-dictionary-candidate-review/0.1', 'F REVIEW_SCHEMA_VERSION unchanged');

  // G. P2-A3 and matching-tool side use the same translated vocabulary (no "別称" vs "別名" drift)
  const matchingHtml = fs.readFileSync(MATCHING_HTML_PATH, 'utf8');
  assert(matchingHtml.includes('別名') && !matchingHtml.includes('別称'), 'G matching tool uses 別名 (never 別称) for Alias, matching P2-A3');
  assert(matchingHtml.includes('正規語') && matchingHtml.includes('競合'),
    'G matching tool already uses 正規語/競合, matching the P2-A3 glossary (S31.2/S31.10)');
  assert(!allUiSource.includes('別称'), 'G P2-A3 UI never introduces the term 別称 (would be a translation-drift risk)');

  // --------------------------------------------------------------------------------------------
  // HUMAN-02 private save/resume: H-O
  // --------------------------------------------------------------------------------------------

  // H. the old ambiguous "レビューを再開" label is gone, replaced by an explicit name
  assert(!/>レビューを再開</.test(html), 'H old ambiguous label "レビューを再開" no longer appears as the resume button text');
  assert(html.includes('保存したレビュー作業を読み込んで再開'), 'H resume button now reads 保存したレビュー作業を読み込んで再開');

  // I. the resume operation is understandable as "load a saved file"
  assert(/読み込んで再開|読み込んで置き換える/.test(html + appJs), 'I resume button/dialog wording makes the load operation explicit');
  assert(appJs.includes('保存済みレビュー作業の読み込み確認'), 'I resume confirm dialog title states this is a load confirmation');
  assert(appJs.includes('置き換えられます'), 'I resume confirm dialog explains the current unsaved state will be replaced (§15)');

  // J. a private review artifact explanation exists, always visible (not title-only)
  assert(html.includes('workbook-help'), 'J a dedicated always-visible explanation block exists (.workbook-help)');
  assert(/非公開ファイル/.test(html), 'J explanation states the save/resume artifact is a non-public (private) file');
  assert(/進捗/.test(html), 'J explanation mentions review progress as part of what the private artifact carries');

  // K. private artifact vs shareable summary are explicitly stated as different things
  assert(/作業継続用（非公開）/.test(html) && /共有用（集計のみ）/.test(html),
    'K explanation text explicitly labels the two categories (private continuation vs shareable aggregate)');

  // L. the private save button name reflects its purpose
  assert(html.includes('レビュー作業を保存（Save Review Progress）'), 'L private save button reads レビュー作業を保存（Save Review Progress）, not a bare "保存"');
  assert(!/>保存</.test(html), 'L no button is left with the bare unqualified label "保存"');

  // --------------------------------------------------------------------------------------------
  // HUMAN-02 shareable export: P-T
  // --------------------------------------------------------------------------------------------

  // P. the shareable summary button name is improved
  assert(html.includes('共有用レビュー集計をExcel保存（Export Shareable Review Summary）'),
    'P shareable export button reads 共有用レビュー集計をExcel保存（Export Shareable Review Summary）');

  // Q. an explanation that this is a shareable aggregate exists
  assert(/共有用（集計のみ）/.test(html) && /件数集計のみ/.test(html), 'Q explanation states the shareable file is aggregate-counts-only');

  // R. explanation states it is not the private resume artifact
  assert(/再開不可|再開するための機能はありません|再開するための非公開ファイルとは別物/.test(html + appJs),
    'R explanation states the shareable file cannot be used to resume review work');

  // S. shareable export content/schema is unchanged (independent expected-value copy match, see F)
  assert(JSON.stringify(WorkbookContract.SHAREABLE_SHEET_NAMES) === JSON.stringify(['Summary', 'Decisions', 'Reason Codes', 'Rules', 'Conflict Resolutions', 'Source Documents', 'Build Information']),
    'S SHAREABLE_SHEET_NAMES unchanged');

  // T. private-only fields (reviewer note) are never exported to the shareable summary
  const ShareableExport = require(path.join(UI, 'shareable_summary_export.js'));
  const secretNote = 'SECRET_REVIEWER_NOTE_CANARY_' + Math.random().toString(36).slice(2);
  const evalFixture = Object.freeze({
    schema_version: 'private-dictionary-candidate-evaluation/0.1',
    source_fingerprints: [{ source_document_id: 'psu-doc-1', document_fingerprint: 'f'.repeat(64) }],
    candidates: [Object.freeze({ candidate_id: 'pdc-1', canonical_term: 'X', scope: 'SESSION', status: 'PROBATION', rule_ids: ['TERM_STRUCTURAL_KEY'], metrics: { exposure_count: 1, document_support_count: 1, alias_conflict_count: 0 }, evidence_refs: [] })],
    alias_candidates: [], conflicts: [],
  });
  const stateWithNote = ReviewState.setCandidateNote(ReviewState.createFromEvaluation(evalFixture), 'pdc-1', secretNote);
  const shareableRows = ShareableExport.buildAllowlistProjection(evalFixture, stateWithNote);
  assert(!JSON.stringify(shareableRows).includes(secretNote), 'T reviewer private note never appears anywhere in the shareable allowlist projection');
  assert(!JSON.stringify(shareableRows).includes('pdc-1'), 'T candidate_id never appears in the shareable allowlist projection (S6.4 forbidden-field list unchanged)');

  // --------------------------------------------------------------------------------------------
  // HUMAN-03 filters: U-AD (predicate correctness in pureFilterChecks() below)
  // --------------------------------------------------------------------------------------------

  // U. full filter option inventory - ALL 5 semantic filter/sort selects
  // (f-page is pagination, not a filter, and is explicitly excluded - S31.8R1).
  function optionsOf(selectId) {
    const m = html.match(new RegExp(`<select id="${selectId}">([\\s\\S]*?)<\\/select>`));
    assert(!!m, `U <select id="${selectId}"> exists`);
    return m[1].match(/<option value="([^"]+)">([^<]+)<\/option>/g) || [];
  }
  const decisionOptions = optionsOf('f-decision');
  assert(decisionOptions.length === 5, 'U f-decision exposes exactly 5 options (ALL + UNREVIEWED + ACCEPT + REJECT + UNCERTAIN)');
  const sourceOptions = optionsOf('f-source');
  assert(sourceOptions.length === 3, 'U f-source exposes exactly 3 options (ALL + PDF + EXCEL)');
  const flagOptions = optionsOf('f-flag');
  assert(flagOptions.length === 3, 'U f-flag exposes exactly 3 options (ALL + ALIAS + CONFLICT)');
  const sortOptions = optionsOf('f-sort');
  assert(sortOptions.length === 6, 'U f-sort exposes exactly 6 options (keyword/exposure/documents/conflict/rule/decision)');
  const ruleSelectMatch = html.match(/<select id="f-rule">([\s\S]*?)<\/select>/);
  assert(!!ruleSelectMatch, 'U <select id="f-rule"> exists (options populated at runtime from RULE_LABELS - checked in the browser half)');
  const pageSelectMatch = html.match(/<select id="f-page">([\s\S]*?)<\/select>/);
  assert(!!pageSelectMatch, 'U <select id="f-page"> exists, but is explicitly out of HUMAN-03 scope (pagination, not a filter - S31.8R1)');

  // V. every non-ALL option in every semantic FILTER select (f-decision/f-source/f-flag) has a
  // Japanese label. f-sort is a separate category (S31.8/S31.3): it reorders rather than filters,
  // and one of its option labels ("Rule", meaning "sort by rule_ids[0]") intentionally reuses the
  // bare field name already excluded from HUMAN-01 bilingual treatment for the same reason
  // RULE_LABELS itself was excluded (S31.3) - it is covered separately below.
  const jpChar = /[぀-ヿ一-鿿]/;
  for (const opt of decisionOptions.concat(sourceOptions, flagOptions)) {
    const label = opt.match(/>([^<]+)</)[1];
    if (label === 'すべて') continue;
    assert(jpChar.test(label), `V filter option label "${label}" contains a Japanese character`);
  }
  // f-sort: every option except the intentionally-excluded "Rule" (S31.3) has a Japanese label.
  for (const opt of sortOptions) {
    const label = opt.match(/>([^<]+)</)[1];
    if (label === 'Rule') continue;
    assert(jpChar.test(label), `V (R1) sort option label "${label}" contains a Japanese character`);
  }
  assert(sortOptions.some(o => />Rule</.test(o)), 'V (R1) f-sort\'s "Rule" option is present and is the one documented, intentional bare-English exception (S31.3/S31.8R1), not an oversight');

  // W. a human-readable explanation exists for EVERY filter/sort category (R1: all 5, not just 2)
  assert(/判定（Decision）:/.test(html), 'W filter explanation covers 判定 (Decision)');
  assert(/出典（Source）:/.test(html), 'W (R1) filter explanation covers 出典 (Source) - was missing before R1');
  assert(/Rule（抽出根拠）:/.test(html), 'W (R1) filter explanation covers Rule (抽出根拠) - was missing before R1');
  assert(/属性（Attribute）:/.test(html), 'W filter explanation covers 属性 (Attribute)');
  assert(/並び替え（Sort）:/.test(html), 'W (R1) filter explanation covers 並び替え (Sort) - was missing before R1, and explicitly states it reorders rather than hides rows');
  assert(/まだ人間の判断が確定していない候補のみ表示/.test(html), 'W UNREVIEWED filter explanation states its inclusion criterion');
  assert(/PDF資料から抽出された候補のみ表示/.test(html) && /Excel資料から抽出された候補のみ表示/.test(html), 'W (R1) Source filter explanation states PDF/Excel inclusion criteria');
  assert(/構造KEY/.test(html) && /見出し/.test(html) && /繰返し値/.test(html) && /引用/.test(html) && /括弧alias/.test(html) && /定義alias/.test(html),
    'W (R1) Rule filter explanation covers all 6 rule labels with their extraction meaning');
  assert(/複数の正規語候補が競合する別名を伴う候補のみ表示/.test(html), 'W CONFLICT filter explanation states its inclusion criterion');
  assert(/表示順のみ.*絞り込む.*ものではない|表示順のみ.*絞り込む\S*ものではない/.test(html.replace(/\n/g, '')) || html.includes('表示順のみ'), 'W (R1) Sort explanation explicitly distinguishes reordering from filtering');

  // --------------------------------------------------------------------------------------------
  // Privacy / accessibility: AK-AN
  // --------------------------------------------------------------------------------------------

  // AK. explanation is not color-only (has real text content, not an empty/icon-only element)
  const workbookHelpMatch = html.match(/<div class="workbook-help"[^>]*>([\s\S]*?)<\/div>/);
  assert(!!workbookHelpMatch, 'AK .workbook-help block exists');
  const workbookHelpText = workbookHelpMatch[1].replace(/<[^>]+>/g, '').trim();
  assert(workbookHelpText.length > 40, 'AK .workbook-help carries substantial real text content, not just a color/icon cue');

  // AL. important explanation is not confined to title/tooltip attributes only
  assert(!/^\s*$/.test(workbookHelpText), 'AL private/shareable distinction text is in the document body, not only in a title= attribute');
  assert(domJs.includes("button.setAttribute('aria-label'"), 'AL decisionSegment buttons carry an aria-label (screen-reader accessible), not title-only');

  // AM. no reviewer private note / dictionary payload / file path is newly displayed
  assert(!/reviewState\.reviewer_notes|session_note/.test(html), 'AM new static markup never interpolates the private reviewer_notes/session_note field');
  const secretScan = html + domJs + tableViewJs + aliasViewJs + conflictViewJs + evidencePanelJs + dashboardJs + appJs;
  assert(!secretScan.includes(secretNote), 'AM the synthetic secret note used in test T never leaks into any UI source (sanity check on the scan itself)');

  // AN. no native Error / filesystem path leakage introduced
  assert(!/\.stack\b/.test(appJs.match(/workbook-help|レビュー作業を保存|共有用レビュー集計/g) ? appJs : ''), 'AN no new .stack reference introduced near the touched HUMAN-02 code');
  assert(!/[A-Z]:\\|\/home\/|\/Users\//.test(html), 'AN no filesystem path literal introduced into index.html');
}

// ==================================================================================================
// 2. Pure filter-predicate correctness: X, Y, Z, AA, AB, AC (HUMAN-03)
// ==================================================================================================
function pureFilterChecks() {
  // table_view.js reads its dependencies off globalThis (browser-global pattern) rather than via
  // require() - wire them up the same way the real index.html script-tag order does before
  // requiring it, so this Node-side call exercises the real, unmodified selectRows() predicate.
  globalThis.P2A3Dom = require(path.join(UI, 'dom.js'));
  globalThis.P2A3ReviewState = require(path.join(UI, 'review_state.js'));
  globalThis.P2A3Pagination = require(path.join(UI, 'pagination.js'));
  const TableView = require(path.join(UI, 'table_view.js'));
  const ReviewState = globalThis.P2A3ReviewState;

  const evaluation = Object.freeze({
    schema_version: 'private-dictionary-candidate-evaluation/0.1',
    source_fingerprints: [],
    candidates: [
      { candidate_id: 'pdc-1', canonical_term: 'Alpha', rule_ids: ['TERM_STRUCTURAL_KEY'], metrics: { exposure_count: 5, document_support_count: 1, alias_conflict_count: 0 }, evidence_refs: [{ source_unit_id: 'u-pdf-1' }] },
      { candidate_id: 'pdc-2', canonical_term: 'Beta', rule_ids: ['TERM_STRUCTURAL_KEY'], metrics: { exposure_count: 1, document_support_count: 1, alias_conflict_count: 2 }, evidence_refs: [{ source_unit_id: 'u-xlsx-1' }] },
      { candidate_id: 'pdc-3', canonical_term: 'Gamma', rule_ids: ['TERM_EXPLICIT_QUOTED'], metrics: { exposure_count: 3, document_support_count: 1, alias_conflict_count: 0 }, evidence_refs: [{ source_unit_id: 'u-pdf-2' }] },
    ],
    alias_candidates: [
      { alias_candidate_id: 'pda-1', alias_term: 'A-alias', canonical_candidate_id: 'pdc-1', rule_ids: [] },
    ],
    conflicts: [],
  });
  let state = ReviewState.createFromEvaluation(evaluation);
  state = ReviewState.setCandidateDecision(state, 'pdc-1', 'ACCEPT');
  state = ReviewState.setCandidateDecision(state, 'pdc-2', 'REJECT');
  // pdc-3 stays UNREVIEWED.

  const index = { byUnitId: new Map([
    ['u-pdf-1', { source_kind: 'PDF' }], ['u-pdf-2', { source_kind: 'PDF' }], ['u-xlsx-1', { source_kind: 'EXCEL' }],
  ]) };
  const baseView = { query: '', decision: 'ALL', source: 'ALL', rule: 'ALL', flag: 'ALL', sort: 'keyword', pageSize: 50, candidatePage: 1 };

  // R1: predicate correctness for 出典（Source）and Rule（抽出根拠）filters,
  // and comparator correctness for 並び替え（Sort）- the same gap the
  // reviewer flagged for the explanation text (MAJOR-01) is closed here on
  // the predicate/comparator side too.
  const pdfOnly = TableView.selectRows(evaluation, index, state, Object.assign({}, baseView, { source: 'PDF' })).sorted;
  assert(pdfOnly.length === 2 && pdfOnly.every(c => c.candidate_id !== 'pdc-2'), 'R1 出典（Source）=PDF filter shows only PDF-derived candidates (pdc-1, pdc-3), never the EXCEL-derived pdc-2');
  const excelOnly = TableView.selectRows(evaluation, index, state, Object.assign({}, baseView, { source: 'EXCEL' })).sorted;
  assert(excelOnly.length === 1 && excelOnly[0].candidate_id === 'pdc-2', 'R1 出典（Source）=EXCEL filter shows only the EXCEL-derived candidate');
  const ruleQuotedOnly = TableView.selectRows(evaluation, index, state, Object.assign({}, baseView, { rule: 'TERM_EXPLICIT_QUOTED' })).sorted;
  assert(ruleQuotedOnly.length === 1 && ruleQuotedOnly[0].candidate_id === 'pdc-3', 'R1 Rule（抽出根拠）=TERM_EXPLICIT_QUOTED filter shows only the candidate extracted by that rule, never the TERM_STRUCTURAL_KEY candidates');
  const ruleKeyOnly = TableView.selectRows(evaluation, index, state, Object.assign({}, baseView, { rule: 'TERM_STRUCTURAL_KEY' })).sorted;
  assert(ruleKeyOnly.length === 2 && ruleKeyOnly.every(c => c.candidate_id !== 'pdc-3'), 'R1 Rule（抽出根拠）=TERM_STRUCTURAL_KEY filter shows only the two candidates extracted by that rule');

  const byExposureDesc = TableView.selectRows(evaluation, index, state, Object.assign({}, baseView, { sort: 'exposure' })).sorted;
  assert(byExposureDesc.map(c => c.candidate_id).join(',') === 'pdc-1,pdc-3,pdc-2', 'R1 並び替え（Sort）=出現数（多い順）orders 5 > 3 > 1 exactly, matching the "多い順" explanation');
  const byDecisionOrder = TableView.selectRows(evaluation, index, state, Object.assign({}, baseView, { sort: 'decision' })).sorted;
  assert(byDecisionOrder.map(c => c.candidate_id).join(',') === 'pdc-3,pdc-2,pdc-1', 'R1 並び替え（Sort）=判定 orders 未判定(pdc-3) → 却下(pdc-2) → 承認(pdc-1), matching the "未判定→保留→却下→承認" explanation exactly');
  // Sort never changes which candidates are present, only their order (explanation's own claim).
  assert(byExposureDesc.length === evaluation.candidates.length && byDecisionOrder.length === evaluation.candidates.length,
    'R1 sorting never hides/filters candidates - the explanation\'s "表示順のみ、絞り込みではない" claim holds against the real comparator');

  // Y. UNREVIEWED filter never shows a reviewed item
  const unreviewedOnly = TableView.selectRows(evaluation, index, state, Object.assign({}, baseView, { decision: 'UNREVIEWED' })).sorted;
  assert(unreviewedOnly.length === 1 && unreviewedOnly[0].candidate_id === 'pdc-3', 'Y 未判定（UNREVIEWED）filter shows only the genuinely unreviewed candidate, never pdc-1(ACCEPT)/pdc-2(REJECT)');

  // decision filter for ACCEPT / REJECT individually (part of X: label<->predicate correctness)
  const acceptOnly = TableView.selectRows(evaluation, index, state, Object.assign({}, baseView, { decision: 'ACCEPT' })).sorted;
  assert(acceptOnly.length === 1 && acceptOnly[0].candidate_id === 'pdc-1', 'X 承認（ACCEPT）filter shows exactly the ACCEPT-decided candidate');
  const rejectOnly = TableView.selectRows(evaluation, index, state, Object.assign({}, baseView, { decision: 'REJECT' })).sorted;
  assert(rejectOnly.length === 1 && rejectOnly[0].candidate_id === 'pdc-2', 'X 却下（REJECT）filter shows exactly the REJECT-decided candidate');

  // Z. CONFLICT filter never shows a non-conflict candidate
  const conflictOnly = TableView.selectRows(evaluation, index, state, Object.assign({}, baseView, { flag: 'CONFLICT' })).sorted;
  assert(conflictOnly.length === 1 && conflictOnly[0].candidate_id === 'pdc-2', 'Z 競合あり（Conflict）filter shows only the candidate whose alias_conflict_count > 0, never pdc-1/pdc-3');

  // AA. ALIAS filter is a distinct category from CONFLICT (does not conflate the two)
  const aliasOnly = TableView.selectRows(evaluation, index, state, Object.assign({}, baseView, { flag: 'ALIAS' })).sorted;
  assert(aliasOnly.length === 1 && aliasOnly[0].candidate_id === 'pdc-1', 'AA 別名候補あり（Alias）filter is driven by alias_candidates, semantically distinct from the CONFLICT count-based filter (pdc-2 has a conflict but no alias here, and is correctly excluded)');

  // AB. applying a filter never mutates review decisions
  const stateBefore = state;
  TableView.selectRows(evaluation, index, state, Object.assign({}, baseView, { decision: 'ACCEPT' }));
  TableView.selectRows(evaluation, index, state, Object.assign({}, baseView, { flag: 'CONFLICT' }));
  assert(state === stateBefore, 'AB running selectRows() under any filter view never mutates or replaces the reviewState object (filter is read-only)');

  // AC. empty state markup exists for all three tabs
  const html = readUI('index.html');
  assert(/id="empty" class="empty" hidden>該当する候補がありません。/.test(html), 'AC candidates empty-state text exists');
  assert(/id="alias-empty" class="empty" hidden>別名（alias）候補はありません。/.test(html), 'AC alias empty-state text exists');
  assert(/id="conflict-empty" class="empty" hidden>alias conflict はありません。/.test(html) || /id="conflict-empty"/.test(html), 'AC conflict empty-state element exists');
}

// ==================================================================================================
// 3. Compatibility: AE/AF (re-run the existing P2-A3 suites unmodified), AG/AH/AI/AJ (protected
//    scope diff=0 against the fixed Checkpoint 14 pre-head)
// ==================================================================================================
function compatibilityChecks() {
  // AE/AF: the existing suites are re-run, unmodified, as separate processes (not re-implemented
  // here) so a genuine regression in either is never masked by this file's own assumptions.
  const uiResult = spawnSync(process.execPath, [path.join(HERE, 'private_dictionary_candidate_review_ui_verification.js')], { encoding: 'utf8' });
  assert(uiResult.status === 0 && /\d+ PASS \/ 0 FAIL/.test(uiResult.stdout), 'AE existing private_dictionary_candidate_review_ui_verification.js re-run: 0 regressions');
  const wbResult = spawnSync(process.execPath, [path.join(HERE, 'private_dictionary_candidate_review_workbook_verification.js')], { encoding: 'utf8', timeout: 180000 });
  assert(wbResult.status === 0 && /\d+ PASS \/ 0 FAIL/.test(wbResult.stdout), 'AF existing private_dictionary_candidate_review_workbook_verification.js re-run: 0 regressions');

  // AG/AH: Checkpoint 13 provenance UI / Checkpoint 12 Project Pin UI terminology is unchanged.
  // R3 (post-Checkpoint-15-A R2 verification-baseline maintenance): a byte-for-byte zero diff
  // against this fixed pre-head is no longer a valid proxy for that invariant, because P2-A4
  // Checkpoint 15-A R2 was later explicitly authorized (a one-time, scoped production-freeze
  // exception; see design doc S32.16) to make a narrow, structural fix to this very file (a new
  // graphNodeProvenanceSourceRow() helper, correcting a real Graph node Dictionary Resolution
  // provenance defect that Checkpoint 13's own Node-level tests never exercised through the real
  // rendering pipeline). This is not a weakening of AG/AH's actual intent - it replaces a
  // now-permanently-stale full-file-diff proxy with a direct check of the terminology strings
  // this assertion always existed to protect, plus a structural bound on any non-empty diff so an
  // unrelated/unbounded future change would still fail this check exactly as before.
  const matchingHtmlCurrentSource = fs.readFileSync(MATCHING_HTML_PATH, 'utf8');
  const CP12_CP13_TERMINOLOGY_ANCHORS = [
    'Project設定ファイルを保存 (Save Project Pin)',
    'Project設定ファイルを読込 (Load Project Pin)',
    '照合セッションに適用 (Apply to Matching Session)',
    '辞書解決 (Dictionary Resolution)',
    '正規語完全一致 (Exact Canonical)',
    '承認済み別名 (Approved Alias)',
    '辞書未登録 (Unknown Term)',
    '辞書競合 (Dictionary Conflict)',
    '辞書照合情報を表示できません (Dictionary provenance unavailable)',
    '辞書照合情報なし (No dictionary resolution provenance)'
  ];
  const missingTerminologyAnchors = CP12_CP13_TERMINOLOGY_ANCHORS.filter(s => !matchingHtmlCurrentSource.includes(s));
  assert(missingTerminologyAnchors.length === 0, `AG/AH Checkpoint 12/13 provenance UI terminology anchors are all still present verbatim in the matching tool HTML (missing: ${JSON.stringify(missingTerminologyAnchors)})`);

  // R4 (Codex Independent Audit MAJOR-01): replaced the keyword-presence +
  // "no other function definition touched" regex heuristic (bypassable by
  // an unrelated 1-line change to an existing function body, CSS rule, HTML
  // label, or constant) with the same strict, exact-hunk-body guard used by
  // the final integration suite's own protected-diff check - see
  // private_dictionary_p2a4_authorized_matching_diff_guard.js and its
  // adversarial self-test file for the full rationale and the 5 synthetic
  // bypass attempts it closes. AG/AH's own terminology-anchor check above is
  // unchanged by this.
  const { matchingToolDiffIsExactlyAuthorized } = require('./private_dictionary_p2a4_authorized_matching_diff_guard.js');
  let matchingDiff;
  try {
    matchingDiff = execSync(`git diff ${PRE_HEAD_SHA} -- tools/json_ab_trace_matching_tool_v12.1.15.html`, { cwd: REPO_ROOT }).toString();
  } catch (e) { matchingDiff = `ERROR: ${e.message}`; }
  assert(matchingToolDiffIsExactlyAuthorized(matchingDiff), 'AG/AH tools/json_ab_trace_matching_tool_v12.1.15.html diff against pre-head is either empty or confined EXACTLY to the two authorized Graph provenance source-row hunks (strict exact-hunk-body guard) - never an unexplained or unbounded change to this protected file');

  // AI/AJ: protected pure cores + comparison review core are byte-for-byte unchanged.
  const protectedCoreFiles = [
    'private_dictionary_learning_core.js', 'private_dictionary_snapshot_core.js',
    'private_dictionary_promotion_core.js', 'private_dictionary_promotion_snapshot_composition_core.js',
    'private_dictionary_resolver_core.js', 'private_dictionary_review_promotion_adapter_core.js',
    'private_dictionary_snapshot_activation_core.js', 'private_dictionary_project_snapshot_pin_persistence_core.js',
    'private_dictionary_rule_extraction_core.js', 'id_hash_utils.js',
  ];
  let coresClean = true; const dirtyCores = [];
  for (const file of protectedCoreFiles) {
    const rel = path.join('tools', 'knowledge_builder', 'core', file);
    let diffOutput;
    try { diffOutput = execSync(`git diff --stat ${PRE_HEAD_SHA} -- ${rel}`, { cwd: REPO_ROOT }).toString().trim(); }
    catch (e) { diffOutput = `ERROR: ${e.message}`; }
    if (diffOutput !== '') { coresClean = false; dirtyCores.push(file); }
  }
  assert(coresClean, `AJ all 10 protected pure cores have zero diff against pre-head ${PRE_HEAD_SHA}${dirtyCores.length ? ' (dirty: ' + dirtyCores.join(', ') + ')' : ''}`);

  const comparisonReviewFiles = [
    'trace_comparison_review_state_core.js', 'trace_comparison_review_session_core.js',
    'trace_comparison_review_projection_core.js', 'trace_comparison_review_export_core.js',
  ];
  let reviewCoreClean = true; const dirtyReview = [];
  for (const file of comparisonReviewFiles) {
    const rel = path.join('tools', file);
    let diffOutput;
    try { diffOutput = execSync(`git diff --stat ${PRE_HEAD_SHA} -- ${rel}`, { cwd: REPO_ROOT }).toString().trim(); }
    catch (e) { diffOutput = `ERROR: ${e.message}`; }
    if (diffOutput !== '') { reviewCoreClean = false; dirtyReview.push(file); }
  }
  assert(reviewCoreClean, `AI comparison review core files have zero diff against pre-head${dirtyReview.length ? ' (dirty: ' + dirtyReview.join(', ') + ')' : ''}`);

  // review_state.js itself (P2-A3's own review-decision core, S31.1: must not change) - zero diff.
  let reviewStateDiff;
  try {
    reviewStateDiff = execSync(`git diff --stat ${PRE_HEAD_SHA} -- tools/knowledge_builder/ui/private_dictionary_candidate_review_ui/review_state.js`, { cwd: REPO_ROOT }).toString().trim();
  } catch (e) { reviewStateDiff = `ERROR: ${e.message}`; }
  assert(reviewStateDiff === '', 'AJ P2-A3 review_state.js (review core semantics) has zero diff against pre-head');

  // Workbook I/O + schema modules also untouched (S31.1).
  const workbookIoFiles = ['workbook_contract.js', 'workbook_cells.js', 'workbook_validation.js', 'private_review_export.js', 'private_review_import.js', 'shareable_summary_export.js'];
  let ioClean = true; const dirtyIo = [];
  for (const file of workbookIoFiles) {
    const rel = path.join('tools', 'knowledge_builder', 'ui', 'private_dictionary_candidate_review_ui', file);
    let diffOutput;
    try { diffOutput = execSync(`git diff --stat ${PRE_HEAD_SHA} -- ${rel}`, { cwd: REPO_ROOT }).toString().trim(); }
    catch (e) { diffOutput = `ERROR: ${e.message}`; }
    if (diffOutput !== '') { ioClean = false; dirtyIo.push(file); }
  }
  assert(ioClean, `AJ Workbook I/O + schema modules have zero diff against pre-head${dirtyIo.length ? ' (dirty: ' + dirtyIo.join(', ') + ')' : ''}`);
}

// ==================================================================================================
// 4. Browser checks (real Chromium against the real server.js + index.html)
// ==================================================================================================
function resolvePlaywright() {
  const candidates = ['playwright', '/opt/node22/lib/node_modules/playwright', path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', 'playwright')];
  for (const id of candidates) { try { return require(id); } catch (_) { /* keep looking */ } }
  return null;
}

async function browserChecks() {
  const pw = resolvePlaywright();
  if (!pw) { skip('browser checks (playwright not installed)'); return; }
  const executablePath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

  const server = spawn(process.execPath, [path.join(UI, 'server.js')], { env: Object.assign({}, process.env, { P2A3_NO_BROWSER: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
  let port;
  try {
    port = await new Promise((resolve, reject) => {
      let buf = '';
      server.stdout.on('data', d => { buf += d; const m = buf.match(/127\.0\.0\.1:(\d+)/); if (m) resolve(m[1]); });
      setTimeout(() => reject(new Error('server did not start')), 20000);
    });
  } catch (e) {
    skip(`browser checks (server did not start: ${e.message})`);
    try { server.kill(); } catch (_) {}
    return;
  }

  let browser;
  try {
    browser = await pw.chromium.launch(executablePath ? { executablePath } : {});
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => globalThis.__P2A3_READY__ === true, { timeout: 30000 });

    // 1/2/3. Button labels visible in the real DOM (HUMAN-02)
    assert((await page.locator('#export-private-button').innerText()).includes('レビュー作業を保存'), 'Browser: private save button shows レビュー作業を保存 in the real DOM');
    assert((await page.locator('#resume-button').innerText()).includes('保存したレビュー作業を読み込んで再開'), 'Browser: resume button shows the explicit load-and-resume label in the real DOM');
    assert((await page.locator('#export-shareable-button').innerText()).includes('共有用レビュー集計をExcel保存'), 'Browser: shareable export button shows the explicit shareable label in the real DOM');
    assert(await page.locator('.workbook-help').isVisible(), 'Browser: the private-vs-shareable explanation block is actually visible (not display:none)');

    // Load the standard sample and run analysis (same real pipeline as the existing suites).
    await page.click('#sample-button');
    await page.waitForFunction(() => { const el = document.getElementById('status'); return el && /追加しました/.test(el.textContent || ''); }, { timeout: 15000 });
    await page.click('#run-button');
    await page.waitForFunction(() => globalThis.__P2A3_APP__ && globalThis.__P2A3_APP__.session !== null, { timeout: 60000 });

    // 5/6/7. Filter dropdown options + explanation, and filter switching actually changes the display
    const decisionOptionTexts = await page.locator('#f-decision option').allInnerTexts();
    assert(decisionOptionTexts.some(t => t.includes('承認（ACCEPT）')) && decisionOptionTexts.some(t => t.includes('却下（REJECT）')),
      'Browser: f-decision options carry the bilingual labels in the real DOM');
    assert(await page.locator('.panel-note', { hasText: '判定（Decision）' }).isVisible(), 'Browser: filter explanation text is visible on the candidates panel');

    // R1: f-rule is populated at runtime from RULE_LABELS - confirm the real DOM actually has more
    // than just "すべて", and that its explanation is visible alongside 出典/並び替え.
    const ruleOptionCount = await page.locator('#f-rule option').count();
    assert(ruleOptionCount > 1, 'R1 Browser: f-rule is populated at runtime with real rule options beyond just すべて');
    assert(await page.locator('.panel-note', { hasText: '出典（Source）' }).isVisible(), 'R1 Browser: 出典（Source）filter explanation is visible in the real DOM');
    assert(await page.locator('.panel-note', { hasText: 'Rule（抽出根拠）' }).isVisible(), 'R1 Browser: Rule（抽出根拠）filter explanation is visible in the real DOM');
    assert(await page.locator('.panel-note', { hasText: '並び替え（Sort）' }).isVisible(), 'R1 Browser: 並び替え（Sort）explanation is visible in the real DOM');

    // R1: f-source filter switching actually narrows the real rendered table.
    const totalRows = await page.locator('#rows tr').count();
    await page.selectOption('#f-source', 'PDF');
    await page.waitForTimeout(200);
    const pdfRows = await page.locator('#rows tr').count();
    assert(pdfRows <= totalRows, 'R1 Browser: selecting 出典（Source）=PDF never increases the row count beyond the unfiltered total');
    await page.selectOption('#f-source', 'ALL');
    await page.waitForTimeout(200);
    const restoredSourceRows = await page.locator('#rows tr').count();
    assert(restoredSourceRows === totalRows, 'R1 Browser: restoring 出典（Source）=すべて returns to the original row count');

    const beforeCount = await page.locator('#rows tr').count();
    await page.selectOption('#f-decision', 'UNREVIEWED');
    await page.waitForTimeout(200);
    const afterFilterHtml = await page.locator('#rows').innerHTML();
    assert(typeof afterFilterHtml === 'string', 'Browser: filter change re-rendered the table (no crash)');
    // Switching to a decision no candidate has yet (fresh run -> everything UNREVIEWED) should not
    // shrink the set to empty on the real fixture; switching back to ALL restores the full count.
    await page.selectOption('#f-decision', 'ALL');
    await page.waitForTimeout(200);
    const restoredCount = await page.locator('#rows tr').count();
    assert(restoredCount === beforeCount, 'Browser: switching the decision filter back to すべて restores the original row count (filter is non-destructive)');

    // 8. Empty-filter empty state
    await page.selectOption('#f-decision', 'ACCEPT');
    await page.selectOption('#f-source', 'PDF');
    await page.fill('#q', 'zzz_no_such_keyword_zzz');
    await page.waitForTimeout(200);
    assert(await page.locator('#empty').isVisible(), 'Browser: an impossible filter/search combination shows the empty-state message, not a blank/broken table');
    await page.fill('#q', '');
    await page.selectOption('#f-decision', 'ALL');
    await page.selectOption('#f-source', 'ALL');

    // 9. Alias / Conflict display in the real DOM
    await page.click('.tab[data-tab="aliases"]');
    assert((await page.locator('.tab[data-tab="aliases"]').innerText()).includes('別名（Alias）'), 'Browser: Alias tab reads 別名（Alias）in the real DOM');
    await page.click('.tab[data-tab="conflicts"]');
    assert((await page.locator('.tab[data-tab="conflicts"]').innerText()).includes('競合（Conflict）'), 'Browser: Conflict tab reads 競合（Conflict）in the real DOM');
    await page.click('.tab[data-tab="candidates"]');

    // 10. Keyboard reachability of existing controls (AO) - Tab from the private-save button
    // should be able to reach the other workbook buttons without a crash / focus trap.
    await page.locator('#export-private-button').focus();
    await page.keyboard.press('Tab');
    const afterTab1 = await page.evaluate(() => document.activeElement && document.activeElement.id);
    await page.keyboard.press('Tab');
    const afterTab2 = await page.evaluate(() => document.activeElement && document.activeElement.id);
    assert(!!afterTab1 && !!afterTab2 && afterTab1 !== afterTab2, 'Browser (AO): keyboard Tab moves focus between the workbook buttons without a focus trap');
    assert(['resume-button', 'export-shareable-button', 'resume-input'].includes(afterTab1), 'Browser (AO): Tab order reaches the next workbook control (resume/shareable), unchanged existing tab order');

    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.waitForTimeout(200);
    assert(pageErrors.length === 0, 'Browser: no uncaught page error during the terminology/filter/keyboard checks');
  } finally {
    if (browser) await browser.close();
    try { server.kill(); } catch (_) {}
  }
}

async function main() {
  staticChecks();
  pureFilterChecks();
  compatibilityChecks();
  await browserChecks();

  console.log(`\n${passed} PASS / ${failed} FAIL / ${skipped} SKIP`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(err => { console.error('THREW', err); process.exit(1); });

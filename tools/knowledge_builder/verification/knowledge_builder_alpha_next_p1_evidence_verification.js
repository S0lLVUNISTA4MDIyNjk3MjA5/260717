#!/usr/bin/env node
/* Knowledge Data Builder Alpha Next P1 (FEEDBACK-INDEPENDENT) - permanent, non-UI evidence
 * hardening tests. Added per the Alpha Next P1 work order: strengthen non-UI verification of
 * JSON validity, required identifiers, provenance/verbatim preservation, saved-JSON reload,
 * and output reproducibility, without changing any existing public Contract, Adapter, Engine,
 * or Store behavior. All assertions below call the existing, unmodified pure functions in
 * tools/knowledge_builder/core/*.js directly (no UI/Playwright dependency), so this suite runs
 * fast and can be part of the ordinary Node-only regression set.
 *
 * Codex Round 1 Finding 2 remediation: added §6, a tamper/failure-injection suite for
 * run_cases.js's validateCaseResult() (imported directly, pure function, no Playwright
 * dependency) - a golden Case A record is confirmed to validate OK, then each contract field is
 * mutated one at a time and validateCaseResult() must reject every mutation. Also strengthened
 * §5 to require the *exact* fixed Candidate counts (7 for Case A, 33 for Case B) instead of the
 * previous `length >= 1`.
 * Run: node tools/knowledge_builder/verification/knowledge_builder_alpha_next_p1_evidence_verification.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const pdfAdapter = require(path.join(ROOT, 'core', 'pdf_direct_adapter.js'));
const excelAdapter = require(path.join(ROOT, 'core', 'excel_direct_adapter.js'));
const engine = require(path.join(ROOT, 'core', 'relation_candidate_engine.js'));
const { validateCaseResult, CASE_A_EXPECTED, CASE_B_EXPECTED } = require(path.join(ROOT, 'alpha_next_p1', 'run_cases.js'));

const FIXTURE_PDF = path.join(ROOT, 'trial', 'trial_package', 'case_01_pdf_excel', 'train_hvac_customer_requirements.pdf');
const FIXTURE_XLSX = path.join(ROOT, 'trial', 'trial_package', 'case_01_pdf_excel', 'train_hvac_design_review.xlsx');
const FIXTURE_PDF_B = path.join(ROOT, 'trial', 'trial_package', 'case_02_pdf_pdf', 'train_hvac_unit_purchase_specification.pdf');
const TAGS = { allowed_tags: ['安全', '性能', '機能', '品質', 'インターフェース', '製造', '検査', '保守'], aliases: {} };
const FIXED_NOW = '2026-08-03T00:00:00.000Z';
const NODE_ID_RE = /^kn-[0-9a-f]{32}$/;
const EDGE_ID_RE = /^ke-[0-9a-f]{32}$/;
const SOURCE_DOC_ID_RE = /^sd-[0-9a-f]{32}$/;

let failures = 0, passCount = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else { passCount++; console.log(`PASS: ${message}`); }
}
function sha256Buf(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

async function runPdf() {
  const buf = fs.readFileSync(FIXTURE_PDF);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return pdfAdapter.adaptPdfDirect(ab, { fileName: 'train_hvac_customer_requirements.pdf', contentDigest: sha256Buf(buf), ingestedAt: FIXED_NOW, tagVocabulary: TAGS });
}
async function runExcel() {
  const buf = fs.readFileSync(FIXTURE_XLSX);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const { workbook } = excelAdapter.inspectWorkbook(ab);
  const sheetName = workbook.SheetNames[0];
  const detected = excelAdapter.detectHeaderAndDataStart(workbook, sheetName);
  return excelAdapter.adaptExcelDirect(ab, { fileName: 'train_hvac_design_review.xlsx', contentDigest: sha256Buf(buf), ingestedAt: FIXED_NOW, sheetName, headerRow: detected.headerRow, dataStartRow: detected.dataStartRow, tagVocabulary: TAGS });
}
async function runPdfB() {
  const buf = fs.readFileSync(FIXTURE_PDF_B);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return pdfAdapter.adaptPdfDirect(ab, { fileName: 'train_hvac_unit_purchase_specification.pdf', contentDigest: sha256Buf(buf), ingestedAt: FIXED_NOW, tagVocabulary: TAGS });
}

async function testReproducibility() {
  const r1 = await runPdf();
  const r2 = await runPdf();
  assert(deepEqual(r1.nodes, r2.nodes), '§1 再現性: 同一PDF入力・同一opts(固定ingestedAt)から生成したnodesが2回とも完全一致する');
  assert(deepEqual(r1.edges, r2.edges), '§1 再現性: 同一PDF入力から生成したedgesが2回とも完全一致する');
  assert(deepEqual(r1.sourceDocument, r2.sourceDocument), '§1 再現性: sourceDocumentが2回とも完全一致する');

  const e1 = await runExcel();
  const e2 = await runExcel();
  assert(deepEqual(e1.nodes, e2.nodes), '§1 再現性(Excel): 同一入力から生成したnodesが2回とも完全一致する');
  assert(deepEqual(e1.edges, e2.edges), '§1 再現性(Excel): 同一入力から生成したedgesが2回とも完全一致する');

  return { pdfResult: r1, excelResult: e1 };
}

function testRequiredIdentifiers(pdfResult, excelResult) {
  const allNodes = [...pdfResult.nodes, ...excelResult.nodes];
  const allEdges = [...pdfResult.edges, ...excelResult.edges];
  assert(allNodes.every(n => typeof n.node_id === 'string' && NODE_ID_RE.test(n.node_id)), '§2 必須識別子: 全nodeのnode_idが `kn-<32桁hex>` 形式で欠落なく存在する');
  assert(allEdges.every(e => typeof e.edge_id === 'string' && EDGE_ID_RE.test(e.edge_id)), '§2 必須識別子: 全edgeのedge_idが `ke-<32桁hex>` 形式で欠落なく存在する');
  assert(SOURCE_DOC_ID_RE.test(pdfResult.sourceDocument.source_document_id), '§2 必須識別子: PDF sourceDocument.source_document_idが `sd-<32桁hex>` 形式');
  assert(SOURCE_DOC_ID_RE.test(excelResult.sourceDocument.source_document_id), '§2 必須識別子: Excel sourceDocument.source_document_idが `sd-<32桁hex>` 形式');

  const nodeIds = allNodes.map(n => n.node_id);
  assert(new Set(nodeIds).size === nodeIds.length, '§2 必須識別子: node_idの重複が0件');
  const edgeIds = allEdges.map(e => e.edge_id);
  assert(new Set(edgeIds).size === edgeIds.length, '§2 必須識別子: edge_idの重複が0件');

  const nodeIdSet = new Set(nodeIds);
  assert(allEdges.every(e => nodeIdSet.has(e.source_node_id) && nodeIdSet.has(e.target_node_id)), '§2 必須識別子: 全edgeのsource/target node_idが実在するnodeを指す');
  assert(allNodes.every(n => n.parent_node_id === null || nodeIdSet.has(n.parent_node_id)), '§2 必須識別子: 全nodeのparent_node_idがnullまたは実在するnodeを指す');
}

function testProvenanceAndVerbatim(pdfResult, excelResult) {
  const pdfStatements = pdfResult.nodes.filter(n => n.node_type === 'statement');
  assert(pdfStatements.length > 0, '§3 provenance(PDF): statement Nodeが1件以上存在する');
  assert(pdfStatements.every(n => n.provenance && n.provenance.source_document_id === pdfResult.sourceDocument.source_document_id), '§3 provenance(PDF): 全statementのprovenance.source_document_idが正しい文書を指す');
  assert(pdfStatements.every(n => n.provenance.locator && n.provenance.locator.kind === 'pdf' && Number.isInteger(n.provenance.locator.page) && n.provenance.locator.page >= 1), '§3 provenance(PDF): 全statementのlocatorがkind=pdf・1始まりのpage番号を保持する');
  assert(pdfStatements.every(n => typeof n.provenance.verbatim.source_raw_text === 'string' && n.provenance.verbatim.source_raw_text.length > 0), '§3 verbatim(PDF): 全statementのverbatim.source_raw_textが空でない原文を保持する');
  // 原文が意図せず改変されていないか: 正規化済みtextの主要部分がraw原文にも(改行の違いを除き)含まれることを抜き取り確認する。
  const sample = pdfStatements[0];
  const rawCollapsed = sample.provenance.verbatim.source_raw_text.replace(/\s+/g, '');
  const normalizedCollapsed = sample.text.replace(/\s+/g, '');
  assert(rawCollapsed.length > 0 && normalizedCollapsed.length > 0, '§3 verbatim(PDF): 抜き取りNodeの原文・正規化本文がともに非空');
  assert(normalizedCollapsed.includes(rawCollapsed.slice(0, 10)) || rawCollapsed.includes(normalizedCollapsed.slice(0, 10)),
    '§3 verbatim(PDF): 抜き取りNodeの正規化本文の先頭部分が原文由来の文字列と対応している(意図しない改変がない)');

  const excelStatements = excelResult.nodes.filter(n => n.node_type === 'statement');
  assert(excelStatements.length > 0, '§3 provenance(Excel): statement Nodeが1件以上存在する');
  assert(excelStatements.every(n => n.provenance.verbatim && typeof n.provenance.verbatim.source_record === 'object' && n.provenance.verbatim.source_record !== null), '§3 verbatim(Excel): 全statementのverbatim.source_recordがセル原値オブジェクトを保持する');
  assert(excelStatements.every(n => Object.keys(n.provenance.verbatim.source_record).length > 0), '§3 verbatim(Excel): 全statementのsource_recordが1列以上の原値を持つ(改変で空にならない)');
}

function testJsonValidityAndReload(pdfResult, excelResult) {
  const combined = {
    sources: [pdfResult.sourceDocument, excelResult.sourceDocument],
    nodes: [...pdfResult.nodes, ...excelResult.nodes],
    edges: [...pdfResult.edges, ...excelResult.edges]
  };
  const text = JSON.stringify(combined);
  let parsed = null, parseOk = false;
  try { parsed = JSON.parse(text); parseOk = true; } catch (e) { /* leave parseOk=false */ }
  assert(parseOk, '§4 JSON検証: 生成データがJSON.stringify/JSON.parseで往復できる');
  assert(parseOk && parsed.nodes.length === combined.nodes.length && parsed.edges.length === combined.edges.length,
    '§4 JSON検証: 再読込後のnode/edge件数が元データと一致する(保存JSON再読込相当)');
  assert(parseOk && deepEqual(parsed, combined), '§4 JSON検証: 再読込後のデータが元データと完全一致する(情報欠落なし)');
}

async function testCandidateEngineDeterminism(pdfResult, excelResult, pdfBResult) {
  const src = pdfResult.nodes.filter(n => n.node_type === 'statement');
  const tgt = excelResult.nodes.filter(n => n.node_type === 'statement');
  const c1 = await engine.generateCandidates(src, tgt, { generatedAt: FIXED_NOW });
  const c2 = await engine.generateCandidates(src, tgt, { generatedAt: FIXED_NOW });
  assert(deepEqual(c1, c2), '§5 再現性(Candidate): 同一Node集合・同一generatedAtから生成したCandidateが2回とも完全一致する');
  // 是正Finding 2: `length >= 1`ではなく、固定Case契約どおりの正確な件数を要求する。
  assert(c1.length === CASE_A_EXPECTED.candidate_count, `§5 Candidate(Case A契約): 正確に${CASE_A_EXPECTED.candidate_count}件生成される(実際: ${c1.length})`);

  const tgtB = pdfBResult.nodes.filter(n => n.node_type === 'statement');
  const cB1 = await engine.generateCandidates(src, tgtB, { generatedAt: FIXED_NOW });
  const cB2 = await engine.generateCandidates(src, tgtB, { generatedAt: FIXED_NOW });
  assert(deepEqual(cB1, cB2), '§5 再現性(Candidate, Case B): 同一Node集合・同一generatedAtから生成したCandidateが2回とも完全一致する');
  assert(cB1.length === CASE_B_EXPECTED.candidate_count, `§5 Candidate(Case B契約): 正確に${CASE_B_EXPECTED.candidate_count}件生成される(実際: ${cB1.length})`);
}

// ---- §6 Finding 2: run_cases.jsのvalidateCaseResult()に対するtamper/failure injection検査 ----
// 「Candidate件数が7件」等の固定契約に対し、golden(契約どおりの実測値)がPASSすることをまず
// 確認し、その後に契約上の各項目を1つずつ改変して、必ずreject(ok=false)されることを検査する。
function goldenActualForCaseA() {
  return {
    case_id: 'case_01_pdf_excel',
    input_a: { sha256: CASE_A_EXPECTED.input_a_sha256 },
    input_b: { sha256: CASE_A_EXPECTED.input_b_sha256 },
    preview_ok: true,
    node_breakdown_by_document: [
      { file_name: 'train_hvac_customer_requirements.pdf', document: 1, section: 14, statement: 12 },
      { file_name: 'train_hvac_design_review.xlsx', document: 1, section: 1, statement: 13 }
    ],
    total_nodes: 42,
    structural_edge_count: 40,
    candidate_count: 7,
    ingest_ok: true,
    json_parse_ok: true,
    json_reload_ok: true,
    error_count: 0,
    warning_count: 0,
    console_error_count: 0,
    external_network_request_count: 0
  };
}

function testValidatorTamperInjection() {
  const golden = goldenActualForCaseA();
  const goldenResult = validateCaseResult(golden, CASE_A_EXPECTED);
  assert(goldenResult.ok && goldenResult.failures.length === 0, '§6 tamper検査: 契約どおりのgolden実測値はvalidateCaseResult()でok=trueになる(前提の健全性確認)');

  const mutations = [
    ['input SHA', a => { a.input_a = { ...a.input_a, sha256: '0'.repeat(64) }; }],
    ['node数(customer_requirements.section)', a => { a.node_breakdown_by_document = a.node_breakdown_by_document.map(d => d.file_name === 'train_hvac_customer_requirements.pdf' ? { ...d, section: d.section + 1 } : d); }],
    ['structural edge', a => { a.structural_edge_count += 1; }],
    ['Candidate件数', a => { a.candidate_count += 1; }],
    ['parse', a => { a.json_parse_ok = false; }],
    ['reload', a => { a.json_reload_ok = false; }],
    ['diagnostics error', a => { a.error_count = 1; }],
    ['warning', a => { a.warning_count = 1; }],
    ['console error', a => { a.console_error_count = 1; }],
    ['external request', a => { a.external_network_request_count = 1; }],
    ['ingest_ok', a => { a.ingest_ok = false; }],
    // 是正Round 1.1: preview tamper(既存11件とは別枠として数える)。
    ['preview_ok', a => { a.preview_ok = false; }]
  ];

  for (const [label, mutate] of mutations) {
    const tampered = JSON.parse(JSON.stringify(golden));
    mutate(tampered);
    const result = validateCaseResult(tampered, CASE_A_EXPECTED);
    assert(!result.ok && result.failures.length >= 1, `§6 tamper検査: 「${label}」を改変するとvalidateCaseResult()が必ずreject(ok=false)する(実際: ok=${result.ok}, failures=${result.failures.length}件)`);
  }

  // 是正Round 1.1: Case識別・文書集合のtamper検査(preview tamperとは別枠として数える)。
  const identityMutations = [
    ['case_id改変', a => { a.case_id = 'case_99_wrong'; }],
    ['期待外文書エントリ追加', a => { a.node_breakdown_by_document = [...a.node_breakdown_by_document, { file_name: 'unexpected_extra_document.pdf', document: 1, section: 1, statement: 1 }]; }],
    ['file_name重複', a => { a.node_breakdown_by_document = [...a.node_breakdown_by_document, { ...a.node_breakdown_by_document[0] }]; }]
  ];
  for (const [label, mutate] of identityMutations) {
    const tampered = JSON.parse(JSON.stringify(golden));
    mutate(tampered);
    const result = validateCaseResult(tampered, CASE_A_EXPECTED);
    assert(!result.ok && result.failures.length >= 1, `§6 tamper検査(Case識別・文書集合): 「${label}」を改変するとvalidateCaseResult()が必ずreject(ok=false)する(実際: ok=${result.ok}, failures=${result.failures.length}件)`);
  }
}

async function main() {
  const { pdfResult, excelResult } = await testReproducibility();
  testRequiredIdentifiers(pdfResult, excelResult);
  testProvenanceAndVerbatim(pdfResult, excelResult);
  testJsonValidityAndReload(pdfResult, excelResult);
  const pdfBResult = await runPdfB();
  await testCandidateEngineDeterminism(pdfResult, excelResult, pdfBResult);
  testValidatorTamperInjection();

  console.log(`\n${passCount} PASS, ${failures} FAIL`);
  if (failures > 0) { console.error('SOME TESTS FAILED'); process.exit(1); }
  console.log('ALL PASS');
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });

#!/usr/bin/env node
/* Knowledge Data Builder Alpha Next P1 (FEEDBACK-INDEPENDENT) - permanent, non-UI evidence
 * hardening tests. Added per the Alpha Next P1 work order: strengthen non-UI verification of
 * JSON validity, required identifiers, provenance/verbatim preservation, saved-JSON reload,
 * and output reproducibility, without changing any existing public Contract, Adapter, Engine,
 * or Store behavior. All assertions below call the existing, unmodified pure functions in
 * tools/knowledge_builder/core/*.js directly (no UI/Playwright dependency), so this suite runs
 * fast and can be part of the ordinary Node-only regression set.
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

const FIXTURE_PDF = path.join(ROOT, 'trial', 'trial_package', 'case_01_pdf_excel', 'train_hvac_customer_requirements.pdf');
const FIXTURE_XLSX = path.join(ROOT, 'trial', 'trial_package', 'case_01_pdf_excel', 'train_hvac_design_review.xlsx');
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

async function testCandidateEngineDeterminism(pdfResult, excelResult) {
  const src = pdfResult.nodes.filter(n => n.node_type === 'statement');
  const tgt = excelResult.nodes.filter(n => n.node_type === 'statement');
  const c1 = await engine.generateCandidates(src, tgt, { generatedAt: FIXED_NOW });
  const c2 = await engine.generateCandidates(src, tgt, { generatedAt: FIXED_NOW });
  assert(deepEqual(c1, c2), '§5 再現性(Candidate): 同一Node集合・同一generatedAtから生成したCandidateが2回とも完全一致する');
  assert(c1.length >= 1, '§5 Candidate: 1件以上生成される(既定minScore=0.12)');
}

async function main() {
  const { pdfResult, excelResult } = await testReproducibility();
  testRequiredIdentifiers(pdfResult, excelResult);
  testProvenanceAndVerbatim(pdfResult, excelResult);
  testJsonValidityAndReload(pdfResult, excelResult);
  await testCandidateEngineDeterminism(pdfResult, excelResult);

  console.log(`\n${passCount} PASS, ${failures} FAIL`);
  if (failures > 0) { console.error('SOME TESTS FAILED'); process.exit(1); }
  console.log('ALL PASS');
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });

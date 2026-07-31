#!/usr/bin/env node
/* Knowledge Data Contract 0.1 - core module verification (Node.js).
 * Exercises: Trace JSON Adapter losslessness (§6.1.1), dual-hash split (§6.6),
 * Relation Candidate generation, Edge lifecycle, Review stale detection (§7.3),
 * Edge stale detection (§6.5), and dataset validation (§9.2).
 * Run: node tools/knowledge_builder/verification/knowledge_builder_core_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IdHash = require('../core/id_hash_utils.js');
const Adapter = require('../core/trace_json_adapter.js');
const CandidateEngine = require('../core/relation_candidate_engine.js');
const Store = require('../core/knowledge_store.js');

const SAMPLE_DIR = path.join(__dirname, '..', '..', '..', 'samples', 'hvac_trace_sample_small');
const VOCAB_PATH = path.join(__dirname, '..', '..', 'alpha_release', 'pdf_excel_json_tools_alpha_v0.10.1_ai_review_handoff', 'shared', 'tag_vocabulary.json');

let failures = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else console.log(`PASS: ${message}`);
}

function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

async function main() {
  const aPath = path.join(SAMPLE_DIR, 'JSON_A_customer_requirements_trace.json');
  const bPath = path.join(SAMPLE_DIR, 'JSON_B_design_review_trace.json');
  const aRaw = fs.readFileSync(aPath);
  const bRaw = fs.readFileSync(bPath);
  const traceA = JSON.parse(aRaw.toString('utf8'));
  const traceB = JSON.parse(bRaw.toString('utf8'));
  const vocab = JSON.parse(fs.readFileSync(VOCAB_PATH, 'utf8'));

  const ingestedAt = new Date().toISOString();
  const actorAdapter = { type: 'ai', id: 'trace-json-adapter' };
  const actorHuman = { type: 'human', id: 'evaluator-1' };

  // ---- 1. Adapter: producer detection ----
  assert(Adapter.detectProducer(traceA._trace_records[0]) === 'pdf', 'JSON_A(customer requirements) はpdf producerとして検出される');
  assert(Adapter.detectProducer(traceB._trace_records[0]) === 'excel', 'JSON_B(design review) はexcel producerとして検出される');

  const resultA = await Adapter.adaptTraceJson(traceA, { role: 'requirement', contentDigest: sha256Hex(aRaw), ingestedAt });
  const resultB = await Adapter.adaptTraceJson(traceB, { role: 'design', contentDigest: sha256Hex(bRaw), ingestedAt });

  const uniqueSectionsA = new Set(traceA._trace_records.map(r => r.source_section_id)).size;
  assert(resultA.nodes.length === traceA._trace_records.length + 1 + uniqueSectionsA, 'JSON_A: content nodes + document + section nodes');
  const uniqueSectionsB = new Set(traceB._trace_records.map(r => r.source_section_id)).size;
  assert(resultB.nodes.length === traceB._trace_records.length + 1 + uniqueSectionsB, 'JSON_B: content nodes + document + section nodes');

  // ---- 2. §6.1.1 losslessness: provenance.verbatim から既存hash入力を再構成できる ----
  const { computeRecordContentHash } = IdHash;
  for (const record of traceA._trace_records) {
    const node = resultA.nodes.find(n => n.export_binding.trace_id === record.trace_id);
    assert(!!node, `JSON_A record ${record.trace_id} に対応するKnowledge Nodeが生成される`);
    const directHash = await computeRecordContentHash(record);
    const reconstructed = { trace_id: node.export_binding.trace_id, source_raw_text: node.provenance.verbatim.source_raw_text, tags: node.tags };
    const reconstructedHash = await computeRecordContentHash(reconstructed);
    assert(node.export_binding.content_hash === directHash, `[pdf] ${record.trace_id}: export_binding.content_hash が既存computeRecordContentHash(元record)と一致`);
    assert(reconstructedHash === directHash, `[pdf] ${record.trace_id}: verbatimからの再構成hashが既存hashと一致(losslessness)`);
  }
  for (const record of traceB._trace_records) {
    const node = resultB.nodes.find(n => n.export_binding.trace_id === record.trace_id);
    assert(!!node, `JSON_B record ${record.trace_id} に対応するKnowledge Nodeが生成される`);
    const directHash = await computeRecordContentHash(record);
    const reconstructed = {
      trace_id: node.export_binding.trace_id, source_record: node.provenance.verbatim.source_record,
      source_record_display: node.provenance.verbatim.source_record_display, tags: node.tags, source_row: node.provenance.verbatim.source_row
    };
    const reconstructedHash = await computeRecordContentHash(reconstructed);
    assert(node.export_binding.content_hash === directHash, `[excel] ${record.trace_id}: export_binding.content_hash が既存computeRecordContentHash(元record)と一致`);
    assert(reconstructedHash === directHash, `[excel] ${record.trace_id}: verbatimからの再構成hashが既存hashと一致(losslessness)`);
  }

  // ---- 3. §6.6 dual-hash split: knowledge_hash と export_binding.content_hash は別物 ----
  const firstContentNodeA = resultA.nodes.find(n => n.node_type === 'requirement');
  assert(firstContentNodeA.revision.knowledge_hash !== firstContentNodeA.export_binding.content_hash,
    'knowledge_hash と export_binding.content_hash は異なる値(別アルゴリズム)');

  // ---- 4. Store: ingest + build dataset ----
  const dataset = Store.createEmptyDataset({ tool: 'knowledge_builder_core_verification', version: '0.1-alpha' });
  await Store.setTagVocabulary(dataset, vocab);
  await Store.ingestAdapterResult(dataset, resultA, actorAdapter);
  await Store.ingestAdapterResult(dataset, resultB, actorAdapter);
  assert(dataset.nodes.length === resultA.nodes.length + resultB.nodes.length, 'datasetに両文書のnodeが取り込まれる');
  assert(dataset.operations.length === dataset.nodes.length + resultA.edges.length + resultB.edges.length, 'CREATE_NODE/CREATE_EDGEのoperationがnode/structural edge数だけ記録される');

  let diag = Store.validateDataset(dataset);
  assert(diag.filter(d => d.severity === 'error').length === 0, '取込直後のdatasetにerror diagnosticsがない');

  // ---- 5. Relation Candidate生成 ----
  const contentA = resultA.nodes.filter(n => n.node_type === 'requirement');
  const contentB = resultB.nodes.filter(n => n.node_type === 'design_item');
  const candidates = await CandidateEngine.generateCandidates(contentA, contentB, {
    generatedAt: new Date().toISOString(), existingPairKeys: Store.existingSemanticPairKeys(dataset)
  });
  assert(candidates.length > 0, 'temperature関連のCandidate Edgeが少なくとも1件生成される');
  assert(candidates.every(e => e.lifecycle === 'candidate'), '生成直後は全てlifecycle=candidate');
  assert(candidates.every(e => e.relation_category === 'semantic' && e.relation_type === 'satisfied_by'), 'candidateはsemantic/satisfied_by');
  assert(candidates.every(e => e.evidence.features.length >= 1), '全candidateにevidence.featuresが1件以上ある');

  const tempCandidate = candidates.find(e => {
    const src = dataset.nodes.find(n => n.node_id === e.source_node_id);
    return src && src.tags.includes('使用温度');
  });
  assert(!!tempCandidate, '使用温度タグを持つrequirement由来のcandidateが存在する');

  await Store.addCandidateEdges(dataset, candidates, actorAdapter);

  // ---- 6. Accept/Reject ----
  await Store.promoteCandidate(dataset, tempCandidate.edge_id, actorHuman);
  const promoted = Store.findEdge(dataset, tempCandidate.edge_id);
  assert(promoted.lifecycle === 'active', 'promoteCandidate後はlifecycle=active');
  assert(promoted.revision.knowledge_hash === tempCandidate.revision.knowledge_hash, 'PROMOTE_CANDIDATEはknowledge_hashを変えない(§4.4)');

  const rejectable = candidates.find(e => e.edge_id !== tempCandidate.edge_id);
  if (rejectable) {
    await Store.rejectCandidate(dataset, rejectable.edge_id, actorHuman);
    assert(Store.findEdge(dataset, rejectable.edge_id).lifecycle === 'rejected', 'rejectCandidate後はlifecycle=rejected');
  }

  // ---- 7. Review: 生成 ≠ 確認、reviewしてstale判定 ----
  assert(promoted.review.human.status === 'unreviewed', '自動生成・昇格だけではreview.human.statusはunreviewedのまま(§7.2)');
  await Store.reviewHuman(dataset, 'edge', promoted.edge_id, { verdict: 'accept', note: '妥当と判断' }, actorHuman);
  const reviewed = Store.findEdge(dataset, promoted.edge_id);
  assert(reviewed.review.human.status === 'reviewed', 'REVIEW_HUMAN後はstatus=reviewed');
  assert(!Store.isReviewStale(reviewed, 'human'), 'レビュー直後はreview_staleではない');

  // sourceノードのtextを編集 → knowledge_hash変化 → Edgeがstale、レビューもstaleになる
  const sourceNode = Store.findNode(dataset, reviewed.source_node_id);
  const beforeContentHash = sourceNode.export_binding.content_hash;
  await Store.updateNodeText(dataset, sourceNode.node_id, sourceNode.text + '(改訂)', actorHuman);
  assert(sourceNode.export_binding.content_hash === beforeContentHash,
    'UPDATE_NODE_TEXTはexport_binding.content_hashを変えない(§6.6: textはverbatimではない)');
  const reEdge = Store.findEdge(dataset, reviewed.edge_id);
  assert(Store.isEdgeStale(dataset, reEdge), 'source node編集後、そのnodeを参照するEdgeはedge_staleになる(§6.5)');
  assert(!Store.isReviewStale(reEdge, 'human'),
    'Edge自身のreview_stale(§7.3)はEdge自身のfield(source/target/category/type)が変わった場合のみ発生し、' +
    '接続先nodeの変更はedge_stale(§6.5、上のassertで確認済み)という別軸で表現される(§4.4.1)');
  assert(reEdge.review.human.status === 'reviewed', 'edge_staleでもreview.human.statusは自動でunreviewedへ戻らない(§7.3)');

  // Node自身を直接レビューした場合は、そのNode自身のtext編集でreview_staleになる(§7.3の本来の対象)
  await Store.reviewHuman(dataset, 'node', sourceNode.node_id, { verdict: 'accept', note: null }, actorHuman);
  assert(!Store.isReviewStale(sourceNode, 'human'), 'node直接レビュー直後はreview_staleではない');
  await Store.updateNodeText(dataset, sourceNode.node_id, sourceNode.text + '(再改訂)', actorHuman);
  assert(Store.isReviewStale(sourceNode, 'human'), 'レビュー後にそのnode自身のtextを編集するとreview_staleになる(§7.3)');

  // タグ編集はexport_binding.content_hashも変える(§1.1: tagsはhash入力に含まれる)
  const beforeTagHash = sourceNode.export_binding.content_hash;
  await Store.addTag(dataset, sourceNode.node_id, '性能', actorHuman);
  assert(sourceNode.export_binding.content_hash !== beforeTagHash, 'ADD_TAGはexport_binding.content_hashを変える(§1.1)');
  const reconstructedAfterTag = Store.reconstructRecordForExportHash(sourceNode);
  assert(await computeRecordContentHash(reconstructedAfterTag) === sourceNode.export_binding.content_hash,
    'タグ追加後もverbatim+tagsからexport_binding.content_hashを再現できる(losslessness維持)');

  // ---- 8. dataset全体の再validationとfinalize ----
  diag = Store.validateDataset(dataset);
  assert(diag.filter(d => d.severity === 'error').length === 0, '一連の編集後もerror diagnosticsがない');
  await Store.finalizeDataset(dataset);
  assert(typeof dataset.dataset_id === 'string' && dataset.dataset_id.startsWith('kd-'), 'finalizeDataset()がdataset_idを採番する');
  assert(typeof dataset.generated_at === 'string', 'finalizeDataset()がgenerated_atを設定する');

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });

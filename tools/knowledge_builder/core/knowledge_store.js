/* Knowledge Data Contract 0.1 - Knowledge Store (§5, §6.4, §9.2).
 * Pure-ish command/reducer functions over a plain KnowledgeDataSet object. Every mutating
 * command appends an OperationRecord (§6.4) with before/after `knowledge_hash` (not the
 * export-compat `content_hash`, per §6.6). "freshness"/"review-stale" are always derived
 * (never stored) per §6.5/§4.4.1 - see isNodeStale/isEdgeStale/isReviewStale below.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KnowledgeStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function resolveIdHashUtils() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      return require('./id_hash_utils.js');
    }
    if (globalThis.KnowledgeIdHashUtils) return globalThis.KnowledgeIdHashUtils;
    throw new Error('id_hash_utils.js (KnowledgeIdHashUtils) を読み込めません。');
  }

  const { hashParts, canonicalJson, computeRecordContentHash, nodeKnowledgeHash, edgeKnowledgeHash, datasetId, operationId } = resolveIdHashUtils();

  function nowIso() { return new Date().toISOString(); }

  // §6.4 command_type -> content_hashへの影響 (Contract表のとおり)
  const HASH_CHANGING_COMMANDS = new Set([
    'CREATE_NODE', 'CREATE_EDGE', 'UPDATE_NODE_TEXT', 'ADD_TAG', 'REMOVE_TAG',
    'SET_QUANTITY', 'REMOVE_QUANTITY', 'CHANGE_PROPERTY', 'CHANGE_RELATION',
    'CHANGE_NODE_TYPE', // Contract §11 enum-only拡張の原則に基づくα0.1実装追加(Node粒度編集に必須)
    'DELETE_NODE', 'DELETE_EDGE'
  ]);
  const HASH_PRESERVING_COMMANDS = new Set([
    'PROMOTE_CANDIDATE', 'REJECT_CANDIDATE', 'REVIEW_HUMAN', 'REVIEW_AI', 'RESET_REVIEW'
  ]);

  function createEmptyDataset(generator) {
    return {
      schema_version: 'knowledge-data/0.1',
      dataset_id: null,
      generated_at: null,
      generator: generator || { tool: 'knowledge_builder_tool', version: '0.1-alpha' },
      provenance: {
        hash_algorithm: 'SHA-256',
        id_hash_algorithm: 'SHA-256/128',
        normalization: 'v12-normalize-v1',
        ruleset_version: {}
      },
      sources: [],
      tag_vocabulary: null,
      nodes: [],
      edges: [],
      operations: [],
      diagnostics: [],
      extensions: {}
    };
  }

  async function computeTagVocabularySha256(vocab) {
    const canonical = {
      schema: vocab.schema, vocabulary_id: vocab.vocabulary_id, vocabulary_version: vocab.vocabulary_version,
      allowed_tags: [...(vocab.allowed_tags || [])], aliases: { ...(vocab.aliases || {}) }
    };
    return hashParts('tag-vocabulary-v1', [canonicalJson(canonical)]);
  }

  async function setTagVocabulary(dataset, vocab) {
    const sha = await computeTagVocabularySha256(vocab);
    dataset.tag_vocabulary = {
      schema: vocab.schema, vocabulary_id: vocab.vocabulary_id, vocabulary_version: vocab.vocabulary_version,
      allowed_tags: [...(vocab.allowed_tags || [])], aliases: { ...(vocab.aliases || {}) }, vocabulary_sha256: sha
    };
  }

  function nextSequence(dataset) {
    return dataset.operations.length ? dataset.operations[dataset.operations.length - 1].sequence + 1 : 1;
  }

  async function pushOperation(dataset, { commandType, actor, targetKind, targetId, beforeHash, afterHash, params }) {
    const sequence = nextSequence(dataset);
    const opId = await operationId(dataset.dataset_id || 'pending', sequence, commandType, targetId);
    dataset.operations.push({
      operation_id: opId, sequence, command_type: commandType, actor,
      occurred_at: nowIso(), target_kind: targetKind, target_id: targetId,
      before_hash: beforeHash ?? null, after_hash: afterHash ?? null, params: params || {}
    });
  }

  function findNode(dataset, nodeId) { return dataset.nodes.find(n => n.node_id === nodeId) || null; }
  function findEdge(dataset, edgeId) { return dataset.edges.find(e => e.edge_id === edgeId) || null; }

  // ---- 取込(§10.1 Adapter結果の追加) ----

  async function ingestAdapterResult(dataset, adapterResult, actor) {
    dataset.sources.push(adapterResult.sourceDocument);
    for (const node of adapterResult.nodes) {
      dataset.nodes.push(node);
      await pushOperation(dataset, {
        commandType: 'CREATE_NODE', actor, targetKind: 'node', targetId: node.node_id,
        beforeHash: null, afterHash: node.revision.knowledge_hash
      });
    }
    for (const edge of adapterResult.edges) {
      dataset.edges.push(edge);
      await pushOperation(dataset, {
        commandType: 'CREATE_EDGE', actor, targetKind: 'edge', targetId: edge.edge_id,
        beforeHash: null, afterHash: edge.revision.knowledge_hash
      });
    }
  }

  async function addCandidateEdges(dataset, candidateEdges, actor) {
    for (const edge of candidateEdges) {
      dataset.edges.push(edge);
      await pushOperation(dataset, {
        commandType: 'CREATE_EDGE', actor, targetKind: 'edge', targetId: edge.edge_id,
        beforeHash: null, afterHash: edge.revision.knowledge_hash
      });
    }
  }

  function existingSemanticPairKeys(dataset) {
    const set = new Set();
    for (const e of dataset.edges) {
      if (e.relation_category === 'semantic') set.add(`${e.source_node_id}|${e.target_node_id}|${e.relation_category}|${e.relation_type}`);
    }
    return set;
  }

  // ---- Node編集 ----

  // §6.1.1 losslessness: verbatim + export_binding.trace_id + tags から既存hash入力を
  // 再構成できることを、tags変更のたびに実際に再計算することで証明し続ける。
  function reconstructRecordForExportHash(node) {
    const producer = node.provenance.producer;
    const verbatim = node.provenance.verbatim;
    if (producer === 'pdf') {
      return { trace_id: node.export_binding.trace_id, source_raw_text: verbatim.source_raw_text, tags: node.tags };
    }
    return {
      trace_id: node.export_binding.trace_id, source_record: verbatim.source_record,
      source_record_display: verbatim.source_record_display, tags: node.tags, source_row: verbatim.source_row
    };
  }

  async function recomputeExportContentHash(node) {
    node.export_binding.content_hash = await computeRecordContentHash(reconstructRecordForExportHash(node));
    return node.export_binding.content_hash;
  }

  async function bumpNodeRevision(dataset, node, actor) {
    node.revision.content_revision += 1;
    node.revision.knowledge_hash = await nodeKnowledgeHash(node);
    node.revision.updated_by = actor;
    node.revision.updated_at = nowIso();
    return node.revision.knowledge_hash;
  }

  async function updateNodeText(dataset, nodeId, newText, actor) {
    const node = findNode(dataset, nodeId);
    if (!node) throw new Error(`node not found: ${nodeId}`);
    const before = node.revision.knowledge_hash;
    node.text = String(newText);
    const after = await bumpNodeRevision(dataset, node, actor);
    await pushOperation(dataset, { commandType: 'UPDATE_NODE_TEXT', actor, targetKind: 'node', targetId: nodeId, beforeHash: before, afterHash: after });
  }

  async function setNodeType(dataset, nodeId, newType, actor) {
    const node = findNode(dataset, nodeId);
    if (!node) throw new Error(`node not found: ${nodeId}`);
    const before = node.revision.knowledge_hash;
    node.node_type = newType;
    const after = await bumpNodeRevision(dataset, node, actor);
    await pushOperation(dataset, { commandType: 'CHANGE_NODE_TYPE', actor, targetKind: 'node', targetId: nodeId, beforeHash: before, afterHash: after, params: { node_type: newType } });
  }

  async function addTag(dataset, nodeId, tag, actor) {
    const node = findNode(dataset, nodeId);
    if (!node) throw new Error(`node not found: ${nodeId}`);
    if (node.tags.includes(tag)) return;
    const before = node.revision.knowledge_hash;
    node.tags.push(tag);
    const after = await bumpNodeRevision(dataset, node, actor);
    await recomputeExportContentHash(node); // tagsは既存content_hashの入力にも含まれる(§1.1)
    await pushOperation(dataset, { commandType: 'ADD_TAG', actor, targetKind: 'node', targetId: nodeId, beforeHash: before, afterHash: after, params: { tag } });
  }

  async function removeTag(dataset, nodeId, tag, actor) {
    const node = findNode(dataset, nodeId);
    if (!node) throw new Error(`node not found: ${nodeId}`);
    if (!node.tags.includes(tag)) return;
    const before = node.revision.knowledge_hash;
    node.tags = node.tags.filter(t => t !== tag);
    const after = await bumpNodeRevision(dataset, node, actor);
    await recomputeExportContentHash(node);
    await pushOperation(dataset, { commandType: 'REMOVE_TAG', actor, targetKind: 'node', targetId: nodeId, beforeHash: before, afterHash: after, params: { tag } });
  }

  // ---- Edge lifecycle (§4.4: lifecycle自体はknowledge_hashに影響しない) ----

  async function promoteCandidate(dataset, edgeId, actor) {
    const edge = findEdge(dataset, edgeId);
    if (!edge) throw new Error(`edge not found: ${edgeId}`);
    const hash = edge.revision.knowledge_hash;
    edge.lifecycle = 'active';
    await pushOperation(dataset, { commandType: 'PROMOTE_CANDIDATE', actor, targetKind: 'edge', targetId: edgeId, beforeHash: hash, afterHash: hash });
  }

  async function rejectCandidate(dataset, edgeId, actor) {
    const edge = findEdge(dataset, edgeId);
    if (!edge) throw new Error(`edge not found: ${edgeId}`);
    const hash = edge.revision.knowledge_hash;
    edge.lifecycle = 'rejected';
    await pushOperation(dataset, { commandType: 'REJECT_CANDIDATE', actor, targetKind: 'edge', targetId: edgeId, beforeHash: hash, afterHash: hash });
  }

  // ---- Review (§7.2: 生成 ≠ 確認。before_hash===after_hash) ----

  async function reviewHuman(dataset, targetKind, targetId, { verdict, note }, actor) {
    const target = targetKind === 'node' ? findNode(dataset, targetId) : findEdge(dataset, targetId);
    if (!target) throw new Error(`${targetKind} not found: ${targetId}`);
    const hash = target.revision.knowledge_hash;
    target.review.human = { status: 'reviewed', verdict: verdict ?? null, actor, reviewed_at: nowIso(), note: note ?? null, reviewed_knowledge_hash: hash };
    await pushOperation(dataset, { commandType: 'REVIEW_HUMAN', actor, targetKind, targetId, beforeHash: hash, afterHash: hash, params: { verdict: verdict ?? null } });
  }

  async function reviewAI(dataset, targetKind, targetId, { verdict, note, method, model }, actor) {
    const target = targetKind === 'node' ? findNode(dataset, targetId) : findEdge(dataset, targetId);
    if (!target) throw new Error(`${targetKind} not found: ${targetId}`);
    const hash = target.revision.knowledge_hash;
    target.review.ai = { status: 'reviewed', verdict: verdict ?? null, actor, reviewed_at: nowIso(), note: note ?? null, reviewed_knowledge_hash: hash, method: method ?? null, model: model ?? null };
    await pushOperation(dataset, { commandType: 'REVIEW_AI', actor, targetKind, targetId, beforeHash: hash, afterHash: hash, params: { verdict: verdict ?? null } });
  }

  async function resetReview(dataset, targetKind, targetId, track, actor) {
    const target = targetKind === 'node' ? findNode(dataset, targetId) : findEdge(dataset, targetId);
    if (!target) throw new Error(`${targetKind} not found: ${targetId}`);
    const hash = target.revision.knowledge_hash;
    if (track === 'human') target.review.human = { status: 'unreviewed', verdict: null, actor: null, reviewed_at: null, note: null, reviewed_knowledge_hash: null };
    else target.review.ai = { status: 'unreviewed', verdict: null, actor: null, reviewed_at: null, note: null, reviewed_knowledge_hash: null, method: null, model: null };
    await pushOperation(dataset, { commandType: 'RESET_REVIEW', actor, targetKind, targetId, beforeHash: hash, afterHash: hash, params: { track } });
  }

  // ---- 導出値 (§4.4.1: freshnessは保存しない) ----

  function isEdgeStale(dataset, edge) {
    const source = findNode(dataset, edge.source_node_id);
    const target = findNode(dataset, edge.target_node_id);
    if (!source || !target) return true;
    return edge.generation.source_node_knowledge_hash !== source.revision.knowledge_hash
        || edge.generation.target_node_knowledge_hash !== target.revision.knowledge_hash;
  }

  function isReviewStale(target, track) {
    const review = target.review[track];
    return review.status === 'reviewed' && review.reviewed_knowledge_hash !== target.revision.knowledge_hash;
  }

  // ---- Validation (§9.2 一部。α0.1評価に必要な範囲) ----

  function validateDataset(dataset) {
    const diagnostics = [];
    const err = (code, targetKind, targetId, detail) => diagnostics.push({ code, severity: 'error', target_kind: targetKind, target_id: targetId, detail });
    const warn = (code, targetKind, targetId, detail) => diagnostics.push({ code, severity: 'warning', target_kind: targetKind, target_id: targetId, detail });

    const nodeIds = new Set();
    for (const node of dataset.nodes) {
      if (nodeIds.has(node.node_id)) err('duplicate_node_id', 'node', node.node_id, 'node_idが重複しています。'); // V-1
      nodeIds.add(node.node_id);
      if (node.parent_node_id !== null && !dataset.nodes.some(n => n.node_id === node.parent_node_id)) {
        err('parent_node_not_found', 'node', node.node_id, `parent_node_id ${node.parent_node_id} が存在しません。`); // V-4
      }
      if (!dataset.sources.some(s => s.source_document_id === node.provenance.source_document_id)) {
        err('source_document_not_found', 'node', node.node_id, 'provenance.source_document_idが存在しません。'); // V-3
      }
    }

    const edgeIds = new Set();
    const RELATION_CATEGORY_MAP = {
      related_to: 'semantic', satisfied_by: 'semantic', implemented_by: 'semantic', verified_by: 'semantic',
      contains: 'structural', belongs_to: 'structural'
    };
    for (const edge of dataset.edges) {
      if (edgeIds.has(edge.edge_id)) err('duplicate_edge_id', 'edge', edge.edge_id, 'edge_idが重複しています。'); // V-1
      edgeIds.add(edge.edge_id);
      if (!nodeIds.has(edge.source_node_id)) err('edge_source_not_found', 'edge', edge.edge_id, 'source_node_idが存在しません。'); // V-2
      if (!nodeIds.has(edge.target_node_id)) err('edge_target_not_found', 'edge', edge.edge_id, 'target_node_idが存在しません。'); // V-2
      if (RELATION_CATEGORY_MAP[edge.relation_type] !== edge.relation_category) {
        err('relation_category_mismatch', 'edge', edge.edge_id, `relation_type=${edge.relation_type}はrelation_category=${RELATION_CATEGORY_MAP[edge.relation_type]}であるべきです。`); // V-7
      }
      if (edge.relation_category === 'structural') {
        if (edge.lifecycle !== 'active') err('structural_lifecycle_invalid', 'edge', edge.edge_id, 'structural edgeはlifecycle=activeである必要があります。'); // V-C1
        if (edge.confidence !== 1.0) err('structural_confidence_invalid', 'edge', edge.edge_id, 'structural edgeはconfidence=1.0である必要があります。'); // V-C2
      }
      if (edge.relation_category === 'semantic' && (!edge.evidence.features || edge.evidence.features.length === 0)) {
        err('evidence_empty', 'edge', edge.edge_id, 'semantic edgeはevidence.featuresが1件以上必要です。'); // V-E1
      }
    }

    for (const [i, op] of dataset.operations.entries()) {
      if (op.sequence !== i + 1) err('operation_sequence_invalid', 'dataset', op.operation_id, `sequenceが1始まり連番ではありません(index=${i}, sequence=${op.sequence})。`); // V-O1
      if ((op.command_type === 'REVIEW_HUMAN' || op.command_type === 'REVIEW_AI' || op.command_type === 'RESET_REVIEW') && op.before_hash !== op.after_hash) {
        err('review_changed_hash', op.target_kind, op.target_id, `${op.command_type}はbefore_hash===after_hashである必要があります。`); // V-R3
      }
    }

    if (dataset.tag_vocabulary) {
      const allowed = new Set(dataset.tag_vocabulary.allowed_tags || []);
      for (const node of dataset.nodes) {
        for (const tag of node.tags) {
          if (!allowed.has(tag)) warn('tag_not_in_vocabulary', 'node', node.node_id, `タグ「${tag}」はtag_vocabularyにありません。`); // V-T1
        }
      }
    }

    return diagnostics;
  }

  // ---- 最終出力(§5) ----

  async function finalizeDataset(dataset) {
    dataset.diagnostics = validateDataset(dataset);
    dataset.generated_at = nowIso();
    dataset.dataset_id = await datasetId(dataset.generator.tool, dataset.generator.version, dataset.sources.map(s => s.content_digest));
    return dataset;
  }

  return Object.freeze({
    createEmptyDataset, setTagVocabulary, computeTagVocabularySha256,
    ingestAdapterResult, addCandidateEdges, existingSemanticPairKeys,
    updateNodeText, setNodeType, addTag, removeTag,
    promoteCandidate, rejectCandidate,
    reviewHuman, reviewAI, resetReview,
    isEdgeStale, isReviewStale,
    validateDataset, finalizeDataset,
    findNode, findEdge,
    reconstructRecordForExportHash, recomputeExportContentHash
  });
});

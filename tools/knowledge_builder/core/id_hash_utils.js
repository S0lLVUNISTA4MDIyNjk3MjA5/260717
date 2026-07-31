/* Knowledge Data Contract 0.1 - ID / hash utilities.
 * Browser/Node shared. Reuses normalize/hashParts/canonicalJson/computeRecordContentHash
 * from tools/quantity_sidecar_binding_core.js unmodified (Contract §1.3: no independent
 * re-implementation of the normalization/hash contract, to avoid drift from the existing
 * Export/Sidecar binding algorithm).
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KnowledgeIdHashUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function resolveBindingCore() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      return require('../../quantity_sidecar_binding_core.js');
    }
    if (globalThis.QuantitySidecarBinding) return globalThis.QuantitySidecarBinding;
    throw new Error('quantity_sidecar_binding_core.js (QuantitySidecarBinding) を読み込めません。');
  }

  const Binding = resolveBindingCore();
  const { normalize, hashParts, canonicalJson, computeRecordContentHash } = Binding;

  // §1.4 既存ID契約と同じUTF-8 netstring方式。encodeUtf8Netstring自体は
  // quantity_sidecar_binding_core.jsではexportされていないため、同一仕様
  // (`${byte長}:${値},`)をここで独立実装する(仕様が自明・固定のためdriftしない)。
  function encodeUtf8Netstring(value) {
    const s = String(value ?? '');
    const byteLength = new TextEncoder().encode(s).length;
    return `${byteLength}:${s},`;
  }

  async function id128(namespace, parts) {
    const full = await hashParts(namespace, parts.map(encodeUtf8Netstring));
    return full.slice(0, 32);
  }

  // ---- §8 ID規則 ----

  async function sourceDocumentId(producer, fileName, contentDigest) {
    return 'sd-' + await id128('knowledge-source-id-v1', [producer, fileName, contentDigest]);
  }

  function locatorCanonical(locator) {
    if (!locator || typeof locator !== 'object') throw new Error('locatorが不正です。');
    if (locator.kind === 'pdf') return `pdf|page=${locator.page}|path=${locator.source_path}`;
    if (locator.kind === 'excel') return `excel|sheet=${locator.sheet}|row=${locator.row}|path=${locator.source_path}`;
    throw new Error(`未対応のlocator.kind: ${locator.kind}`);
  }

  async function nodeId(sourceDocId, locator) {
    return 'kn-' + await id128('knowledge-node-id-v1', [sourceDocId, locatorCanonical(locator)]);
  }

  async function edgeId(sourceNodeId, targetNodeId, relationCategory, relationType) {
    return 'ke-' + await id128('knowledge-edge-id-v1', [sourceNodeId, targetNodeId, relationCategory, relationType]);
  }

  async function datasetId(generatorTool, generatorVersion, sourceContentDigests) {
    const sorted = [...sourceContentDigests].sort();
    return 'kd-' + await id128('knowledge-dataset-id-v1', [generatorTool, generatorVersion, ...sorted]);
  }

  async function operationId(datasetIdValue, sequence, commandType, targetId) {
    return 'op-' + await id128('knowledge-operation-id-v1', [datasetIdValue, String(sequence), commandType, targetId]);
  }

  // ---- §6.5 revision.knowledge_hash (既存export_binding.content_hashとは別物。§6.6) ----

  function nodeKnowledgeHashInput(node) {
    return {
      node_type: node.node_type,
      text: node.text,
      title: node.title,
      semantics: node.semantics,
      tags: node.tags,
      quantities: node.quantities,
      parent_node_id: node.parent_node_id
    };
  }

  async function nodeKnowledgeHash(node) {
    return hashParts('knowledge-node-content-v1', [canonicalJson(nodeKnowledgeHashInput(node))]);
  }

  function edgeKnowledgeHashInput(edge) {
    return {
      source_node_id: edge.source_node_id,
      target_node_id: edge.target_node_id,
      relation_category: edge.relation_category,
      relation_type: edge.relation_type
    };
  }

  async function edgeKnowledgeHash(edge) {
    return hashParts('knowledge-edge-content-v1', [canonicalJson(edgeKnowledgeHashInput(edge))]);
  }

  return Object.freeze({
    normalize, hashParts, canonicalJson, computeRecordContentHash,
    encodeUtf8Netstring, id128,
    sourceDocumentId, nodeId, edgeId, datasetId, operationId,
    locatorCanonical, nodeKnowledgeHash, edgeKnowledgeHash
  });
});

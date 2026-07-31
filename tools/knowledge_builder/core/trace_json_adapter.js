/* Knowledge Data Contract 0.1 - Trace JSON Adapter (§10.1).
 * Converts an EXISTING exported trace JSON (chapter-section-trace-v1, `_trace_records[]`,
 * as produced by the PDF/Excel alpha tools) into KnowledgeNode / structural KnowledgeEdge /
 * SourceDocument objects. Does not re-implement PDF/Excel extraction; reuses the already
 * exported record fields verbatim (Contract §1.1/§6.1.1 losslessness requirement).
 *
 * Deliberately excluded from this checkpoint (see tools/knowledge_builder/README.md):
 * Ontology-based node_type inference, full Quantity integration (quantities is always []),
 * semantic property resolution (semantics stays in the "not yet analyzed" shape).
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KnowledgeTraceJsonAdapter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function resolveIdHashUtils() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      return require('./id_hash_utils.js');
    }
    if (globalThis.KnowledgeIdHashUtils) return globalThis.KnowledgeIdHashUtils;
    throw new Error('id_hash_utils.js (KnowledgeIdHashUtils) を読み込めません。');
  }

  const { computeRecordContentHash, sourceDocumentId, nodeId, edgeId, nodeKnowledgeHash, edgeKnowledgeHash } = resolveIdHashUtils();

  function detectProducer(record) {
    if (Object.prototype.hasOwnProperty.call(record || {}, 'source_raw_text')) return 'pdf';
    if (Object.prototype.hasOwnProperty.call(record || {}, 'source_record')) return 'excel';
    throw new Error('producerを判別できません(source_raw_text/source_recordのいずれもありません)。');
  }

  function contentLocator(producer, record) {
    if (producer === 'pdf') {
      return {
        kind: 'pdf',
        page: record.source_page ?? null,
        source_path: record.source_path,
        section_id: record.source_section_id ?? null,
        section_number: record.section_number ?? null,
        section_title: record.source_section_title ?? record.section_title ?? null,
        block_id: record.source_block_id ?? null
      };
    }
    return {
      kind: 'excel',
      sheet: record.source_sheet,
      row: record.source_row,
      source_path: record.source_path
    };
  }

  function sectionLocator(producer, sectionId, sectionTitle) {
    if (producer === 'pdf') {
      return {
        kind: 'pdf', page: null, source_path: `$.section[${sectionId}]`,
        section_id: sectionId, section_number: null, section_title: sectionTitle ?? null, block_id: null
      };
    }
    return { kind: 'excel', sheet: sectionTitle || sectionId, row: 0, source_path: `$.section[${sectionId}]` };
  }

  function documentLocator(producer, fileName) {
    if (producer === 'pdf') {
      return { kind: 'pdf', page: null, source_path: '$.document', section_id: null, section_number: null, section_title: null, block_id: null };
    }
    return { kind: 'excel', sheet: fileName, row: 0, source_path: '$.document' };
  }

  function contentVerbatim(producer, record) {
    if (producer === 'pdf') return { source_raw_text: record.source_raw_text };
    return {
      source_record: record.source_record,
      source_record_display: record.source_record_display ?? null,
      source_row: record.source_row
    };
  }

  // 構造Node(document/section)は既存export形式に対応するTraceRecordを持たないため、
  // 内部一貫性のためだけに合成recordを作りcomputeRecordContentHash()へ通す。
  // これは既存Sidecarとのbinding互換性を主張するものではない(§10.2は
  // 内容Nodeのみをマッピング対象とする)。
  function syntheticStructuralRecord(producer, traceId, label) {
    if (producer === 'pdf') return { trace_id: traceId, source_raw_text: String(label || ''), tags: [] };
    return { trace_id: traceId, source_record: { title: String(label || '') }, source_record_display: null, tags: [], source_row: 0 };
  }

  function structuralVerbatim(producer, label) {
    if (producer === 'pdf') return { source_raw_text: String(label || '') };
    return { source_record: { title: String(label || '') }, source_record_display: null, source_row: 0 };
  }

  const EMPTY_SEMANTICS = () => ({
    subject: { text: null, concept_id: null },
    property: { text: null, concept_id: null },
    statement_type: 'information',
    derived_by: { type: 'ai', id: 'trace-json-adapter' },
    extensions: {}
  });

  const DEFAULT_REVIEW = () => ({
    human: { status: 'unreviewed', verdict: null, actor: null, reviewed_at: null, note: null, reviewed_knowledge_hash: null },
    ai: { status: 'unreviewed', verdict: null, actor: null, reviewed_at: null, note: null, reviewed_knowledge_hash: null, method: null, model: null }
  });

  async function finalizeNode(node) {
    node.revision.knowledge_hash = await nodeKnowledgeHash(node);
    return node;
  }

  /**
   * @param {object} traceJson  既存exportされたtrace JSON(`_trace_records`を持つ)
   * @param {object} opts
   * @param {"requirement"|"design"} opts.role  内容Nodeのnode_type既定値を決める(§3.2)
   * @param {string} opts.contentDigest  実ファイルのSHA-256(64桁hex)
   * @param {string} opts.ingestedAt  canonical UTC timestamp
   * @param {string|null} [opts.documentNumber]
   * @param {string|null} [opts.revisionLabel]
   */
  async function adaptTraceJson(traceJson, opts) {
    const records = Array.isArray(traceJson?._trace_records) ? traceJson._trace_records : null;
    if (!records || !records.length) throw new Error('_trace_recordsが空、または存在しません。');

    const producer = detectProducer(records[0]);
    const fileName = String(traceJson.file_name || records[0].source_file || 'unknown');
    const sourceDocId = await sourceDocumentId(producer, fileName, opts.contentDigest);
    const contentNodeType = opts.role === 'design' ? 'design_item' : 'requirement';

    const sourceDocument = {
      source_document_id: sourceDocId,
      file_name: fileName,
      producer,
      content_digest: opts.contentDigest,
      document_number: opts.documentNumber ?? null,
      revision: opts.revisionLabel ?? null,
      ingested_at: opts.ingestedAt,
      extensions: {}
    };

    const nodes = [];
    const edges = [];

    // document node (root)
    const docTraceId = `doc:${fileName}`;
    const docLocator = documentLocator(producer, fileName);
    const docNodeId = await nodeId(sourceDocId, docLocator);
    const docLabel = String(traceJson.chapter_title || fileName);
    const docNode = await finalizeNode({
      node_id: docNodeId,
      node_type: 'document',
      text: docLabel,
      title: docLabel,
      tags: [],
      unregistered_tags: [],
      semantics: EMPTY_SEMANTICS(),
      quantities: [],
      parent_node_id: null,
      provenance: { source_document_id: sourceDocId, producer, locator: docLocator, verbatim: structuralVerbatim(producer, docLabel), extensions: {} },
      revision: { content_revision: 1, knowledge_hash: null, updated_by: { type: 'ai', id: 'trace-json-adapter' }, updated_at: opts.ingestedAt },
      review: DEFAULT_REVIEW(),
      export_binding: { trace_id: docTraceId, content_hash: await computeRecordContentHash(syntheticStructuralRecord(producer, docTraceId, docLabel)) },
      confidence: 1.0,
      extensions: {}
    });
    nodes.push(docNode);

    const sectionNodeByOriginalId = new Map();

    for (const record of records) {
      const sectionOriginalId = String(record.source_section_id ?? record.parent_id ?? 'section');
      let sectionNode = sectionNodeByOriginalId.get(sectionOriginalId);
      if (!sectionNode) {
        const sectionTitle = record.source_section_title ?? record.section_title ?? null;
        const secLocator = sectionLocator(producer, sectionOriginalId, sectionTitle);
        const secNodeId = await nodeId(sourceDocId, secLocator);
        const label = String(sectionTitle || sectionOriginalId);
        sectionNode = await finalizeNode({
          node_id: secNodeId,
          node_type: 'section',
          text: label,
          title: label,
          tags: [],
          unregistered_tags: [],
          semantics: EMPTY_SEMANTICS(),
          quantities: [],
          parent_node_id: docNodeId,
          provenance: { source_document_id: sourceDocId, producer, locator: secLocator, verbatim: structuralVerbatim(producer, label), extensions: {} },
          revision: { content_revision: 1, knowledge_hash: null, updated_by: { type: 'ai', id: 'trace-json-adapter' }, updated_at: opts.ingestedAt },
          review: DEFAULT_REVIEW(),
          export_binding: { trace_id: sectionOriginalId, content_hash: await computeRecordContentHash(syntheticStructuralRecord(producer, sectionOriginalId, label)) },
          confidence: 1.0,
          extensions: {}
        });
        nodes.push(sectionNode);
        sectionNodeByOriginalId.set(sectionOriginalId, sectionNode);
        edges.push(await makeContainsEdge(docNode, sectionNode, opts.ingestedAt));
      }

      const locator = contentLocator(producer, record);
      const contentNodeId = await nodeId(sourceDocId, locator);
      const title = String(record.trace_title || sectionNode.title || '');
      const text = String(record.trace_text ?? '');
      const contentNode = await finalizeNode({
        node_id: contentNodeId,
        node_type: contentNodeType,
        text,
        title,
        tags: Array.isArray(record.tags) ? [...record.tags] : [],
        unregistered_tags: Array.isArray(record.unregistered_tags) ? [...record.unregistered_tags] : [],
        semantics: EMPTY_SEMANTICS(),
        quantities: [],
        parent_node_id: sectionNode.node_id,
        provenance: { source_document_id: sourceDocId, producer, locator, verbatim: contentVerbatim(producer, record), extensions: {} },
        revision: { content_revision: 1, knowledge_hash: null, updated_by: { type: 'ai', id: 'trace-json-adapter' }, updated_at: opts.ingestedAt },
        review: DEFAULT_REVIEW(),
        export_binding: { trace_id: String(record.trace_id), content_hash: await computeRecordContentHash(record) },
        confidence: 1.0,
        extensions: {}
      });
      nodes.push(contentNode);
      edges.push(await makeContainsEdge(sectionNode, contentNode, opts.ingestedAt));
    }

    return { sourceDocument, nodes, edges };
  }

  async function makeContainsEdge(parentNode, childNode, occurredAt) {
    const eid = await edgeId(parentNode.node_id, childNode.node_id, 'structural', 'contains');
    const edge = {
      edge_id: eid,
      source_node_id: parentNode.node_id,
      target_node_id: childNode.node_id,
      relation_category: 'structural',
      relation_type: 'contains',
      lifecycle: 'active',
      confidence: 1.0,
      evidence: { matching_profile_id: null, features: [{ feature: 'hierarchy', detail: { parent: parentNode.node_id, child: childNode.node_id }, effect: 'supports' }] },
      generation: {
        generated_by: { type: 'ai', id: 'trace-json-adapter' },
        generated_at: occurredAt,
        engine: 'trace-json-adapter',
        source_node_knowledge_hash: parentNode.revision.knowledge_hash,
        target_node_knowledge_hash: childNode.revision.knowledge_hash
      },
      revision: { content_revision: 1, knowledge_hash: null, updated_by: { type: 'ai', id: 'trace-json-adapter' }, updated_at: occurredAt },
      review: {
        human: { status: 'not_applicable', verdict: null, actor: null, reviewed_at: null, note: null, reviewed_knowledge_hash: null },
        ai: { status: 'not_applicable', verdict: null, actor: null, reviewed_at: null, note: null, reviewed_knowledge_hash: null, method: null, model: null }
      },
      extensions: {}
    };
    edge.revision.knowledge_hash = await edgeKnowledgeHash(edge);
    return edge;
  }

  return Object.freeze({ adaptTraceJson, detectProducer });
});

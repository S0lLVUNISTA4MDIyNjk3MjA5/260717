/* Knowledge Data Contract 0.1 - Relation Candidate Engine (§4.5).
 * Minimal α0.1 heuristic: text similarity (character bigram Dice) + tag overlap.
 * Deliberately excludes quantity_dimension features (full Quantity integration is out
 * of scope for this checkpoint, per explicit evaluation-scope decision) and any
 * concept-based property resolution. Produces `lifecycle:"candidate"` edges only -
 * never auto-promotes to "active".
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.KnowledgeRelationCandidateEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  function resolveIdHashUtils() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      return require('./id_hash_utils.js');
    }
    if (globalThis.KnowledgeIdHashUtils) return globalThis.KnowledgeIdHashUtils;
    throw new Error('id_hash_utils.js (KnowledgeIdHashUtils) を読み込めません。');
  }

  const { normalize, edgeId, edgeKnowledgeHash } = resolveIdHashUtils();

  function bigrams(s) {
    const out = new Map();
    if (s.length < 2) { if (s) out.set(s, 1); return out; }
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) || 0) + 1);
    }
    return out;
  }

  function diceSimilarity(a, b) {
    if (a === b) return a ? 1 : 0;
    if (!a || !b) return 0;
    const A = bigrams(a), B = bigrams(b);
    let sumA = 0, sumB = 0, hit = 0;
    A.forEach(v => sumA += v);
    B.forEach(v => sumB += v);
    A.forEach((v, k) => { if (B.has(k)) hit += Math.min(v, B.get(k)); });
    return 2 * hit / Math.max(1, sumA + sumB);
  }

  function tagOverlap(a, b) {
    const setB = new Set(b || []);
    return (a || []).filter(t => setB.has(t));
  }

  const CONTENT_NODE_TYPES = new Set(['requirement', 'design_item', 'verification_item', 'statement']);

  /**
   * @param {object[]} sourceNodes  requirement側(JSON A由来)のKnowledgeNode配列
   * @param {object[]} targetNodes  design側(JSON B由来)のKnowledgeNode配列
   * @param {object} opts
   * @param {number} [opts.minScore=0.12]
   * @param {number} [opts.maxCandidatesPerSource=3]
   * @param {string} opts.generatedAt  canonical UTC timestamp
   * @param {Set<string>} [opts.existingPairKeys]  既存edgeの`${source}|${target}|semantic|satisfied_by`集合(再生成時の重複防止)
   */
  async function generateCandidates(sourceNodes, targetNodes, opts) {
    const minScore = opts.minScore ?? 0.12;
    const maxPerSource = opts.maxCandidatesPerSource ?? 3;
    const existing = opts.existingPairKeys || new Set();
    const candidates = [];

    const sources = sourceNodes.filter(n => CONTENT_NODE_TYPES.has(n.node_type));
    const targets = targetNodes.filter(n => CONTENT_NODE_TYPES.has(n.node_type));

    for (const source of sources) {
      const scored = [];
      const sourceText = normalize(source.text);
      for (const target of targets) {
        const overlap = tagOverlap(source.tags, target.tags);
        const textSim = diceSimilarity(sourceText, normalize(target.text));
        if (overlap.length === 0 && textSim < minScore) continue;
        const score = Math.min(1, 0.6 * textSim + (overlap.length ? 0.4 : 0));
        scored.push({ target, overlap, textSim, score });
      }
      scored.sort((a, b) => b.score - a.score);

      for (const item of scored.slice(0, maxPerSource)) {
        const pairKey = `${source.node_id}|${item.target.node_id}|semantic|satisfied_by`;
        if (existing.has(pairKey)) continue;

        const features = [];
        if (item.overlap.length) features.push({ feature: 'semantic_tag', detail: { matched: item.overlap }, effect: 'supports' });
        features.push({ feature: 'text_similarity', detail: { score: Math.round(item.textSim * 1000) / 1000 }, effect: item.textSim >= minScore ? 'supports' : 'opposes' });
        if (!features.length) continue;

        const eid = await edgeId(source.node_id, item.target.node_id, 'semantic', 'satisfied_by');
        const edge = {
          edge_id: eid,
          source_node_id: source.node_id,
          target_node_id: item.target.node_id,
          relation_category: 'semantic',
          relation_type: 'satisfied_by',
          lifecycle: 'candidate',
          confidence: Math.round(item.score * 1000) / 1000,
          evidence: { matching_profile_id: 'mp-alpha0.1-textsim-tagoverlap', features },
          generation: {
            generated_by: { type: 'ai', id: 'relation-candidate-engine' },
            generated_at: opts.generatedAt,
            engine: 'relation-candidate-engine',
            source_node_knowledge_hash: source.revision.knowledge_hash,
            target_node_knowledge_hash: item.target.revision.knowledge_hash
          },
          revision: { content_revision: 1, knowledge_hash: null, updated_by: { type: 'ai', id: 'relation-candidate-engine' }, updated_at: opts.generatedAt },
          review: {
            human: { status: 'unreviewed', verdict: null, actor: null, reviewed_at: null, note: null, reviewed_knowledge_hash: null },
            ai: { status: 'unreviewed', verdict: null, actor: null, reviewed_at: null, note: null, reviewed_knowledge_hash: null, method: null, model: null }
          },
          extensions: {}
        };
        edge.revision.knowledge_hash = await edgeKnowledgeHash(edge);
        candidates.push(edge);
        existing.add(pairKey);
      }
    }
    return candidates;
  }

  return Object.freeze({ generateCandidates, diceSimilarity });
});

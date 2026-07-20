/* quantity-annotation/1.0-rc1 strict binding core.
 * Browser/Node shared. This phase validates and binds sources only; it does not
 * generate quantity pairs, numeric comparisons, or satisfaction judgements.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.QuantitySidecarBinding = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const SCHEMA_VERSION = 'quantity-annotation/1.0-rc1';
  // Compatibility is intentionally an allow-list of complete tuples. Add a new
  // entry only after cross-version evidence shows the tuple is safe to consume.
  const SUPPORTED_RULESETS = Object.freeze([
    Object.freeze({
      quantity_extraction:'v2.14',
      semantics_rules:'v2.19',
      auto_applicable_thresholds:Object.freeze({ modeConfidence:0.4, margin:0.2, propertyConfidence:0.7 })
    })
  ]);

  function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

  function annotationSchema(explicitSchema) {
    if (explicitSchema) return explicitSchema;
    if (globalThis.QuantityAnnotationSchemaV1) return globalThis.QuantityAnnotationSchemaV1;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      return require('./design_notes/quantity_annotation_schema_v1.json');
    }
    throw new Error('正本quantity_annotation_schema_v1.jsonを読み込めません。');
  }

  // The same supported-keyword validator as json_schema_minivalidator.js, used
  // against the generated browser copy of the canonical JSON Schema.
  function resolveRef(root, ref) {
    if (!ref.startsWith('#/')) throw new Error(`未対応の$ref: ${ref}`);
    let node = root;
    for (const segment of ref.slice(2).split('/')) {
      node = node[segment];
      if (node === undefined) throw new Error(`$refの解決に失敗しました: ${ref}`);
    }
    return node;
  }

  function schemaType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (Number.isInteger(value)) return 'integer';
    return typeof value;
  }

  function typeMatches(expected, value) {
    const actual = schemaType(value);
    const one = exp => exp === 'number' ? (actual === 'number' || actual === 'integer') : actual === exp;
    return Array.isArray(expected) ? expected.some(one) : one(expected);
  }

  function validateSchemaNode(schema, value, path, root, errors) {
    if (schema.$ref) { validateSchemaNode(resolveRef(root, schema.$ref), value, path, root, errors); return; }
    if (schema.oneOf) {
      const branches = schema.oneOf.map(sub => { const e = []; validateSchemaNode(sub, value, path, root, e); return e; });
      if (!branches.some(e => e.length === 0)) errors.push(`${path}: oneOfのいずれの分岐にも一致しない`);
      return;
    }
    if (schema.const !== undefined && value !== schema.const) errors.push(`${path}: const不一致`);
    if (schema.enum !== undefined && !schema.enum.includes(value)) errors.push(`${path}: enum不一致`);
    if (schema.type !== undefined && !typeMatches(schema.type, value)) {
      errors.push(`${path}: type不一致 (期待値=${schema.type}, 実際=${schemaType(value)})`);
      return;
    }
    if (typeof value === 'string') {
      if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: pattern不一致`);
      if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: minLength未満`);
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: minimum未満`);
      if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: maximum超過`);
    }
    if (Array.isArray(value) && schema.items) value.forEach((item, i) => validateSchemaNode(schema.items, item, `${path}[${i}]`, root, errors));
    if (isObject(value)) {
      for (const key of (schema.required || [])) if (!(key in value)) errors.push(`${path}: 必須フィールド不足: ${key}`);
      for (const [key, child] of Object.entries(schema.properties || {})) if (key in value) validateSchemaNode(child, value[key], `${path}.${key}`, root, errors);
      if (schema.additionalProperties === false && schema.properties) {
        for (const key of Object.keys(value)) if (!(key in schema.properties)) errors.push(`${path}: 未定義フィールド(additionalProperties:false): ${key}`);
      }
    }
  }

  function validateAnnotationSchema(doc, explicitSchema) {
    const schema = annotationSchema(explicitSchema);
    const errors = [];
    validateSchemaNode(schema, doc, '$', schema, errors);
    return { valid:errors.length === 0, errors };
  }

  function sameRuleset(actual, supported) {
    const a = actual?.auto_applicable_thresholds;
    const s = supported.auto_applicable_thresholds;
    return actual?.quantity_extraction === supported.quantity_extraction
      && actual?.semantics_rules === supported.semantics_rules
      && a?.modeConfidence === s.modeConfidence
      && a?.margin === s.margin
      && a?.propertyConfidence === s.propertyConfidence;
  }

  function validateRulesetCompatibility(actual) {
    const supported = SUPPORTED_RULESETS.some(entry => sameRuleset(actual, entry));
    return { supported, actual, supported_rulesets:SUPPORTED_RULESETS };
  }

  function normalize(value) {
    return String(value == null ? '' : value).normalize('NFKC').replace(/\r\n?/g, '\n')
      .split('\n').map(line => line.replace(/[ \t]+$/g, '')).join('\n').replace(/[ \t]+/g, ' ').trim();
  }

  function canonicalValue(value) {
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
    return value;
  }

  function canonicalJson(value) { return JSON.stringify(canonicalValue(value)); }

  async function sha256(value) {
    const text = String(value);
    if (typeof process !== 'undefined' && process.versions?.node && typeof require === 'function') return require('crypto').createHash('sha256').update(text, 'utf8').digest('hex');
    if (!globalThis.crypto?.subtle) throw new Error('SHA-256を利用できません。');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function hashParts(namespace, parts) { return sha256([namespace, ...parts.map(normalize)].join(String.fromCharCode(0))); }

  function traceRecords(trace) {
    if (Array.isArray(trace?._trace_records)) return trace._trace_records;
    if (Array.isArray(trace)) return trace;
    return null;
  }

  function duplicateIds(records) {
    const seen = new Set(), duplicates = new Set();
    (records || []).forEach(record => {
      const id = typeof record?.trace_id === 'string' ? record.trace_id : '';
      if (!id || seen.has(id)) duplicates.add(id || '(missing)');
      seen.add(id);
    });
    return [...duplicates];
  }

  async function computeDatasetSignature(records) {
    const duplicates = duplicateIds(records);
    if (duplicates.length) throw new Error(`trace_idが重複しています: ${duplicates.join(', ')}`);
    const sorted = [...records].sort((a, b) => String(a.trace_id).localeCompare(String(b.trace_id)));
    return 'QA-SHA256:' + await hashParts('dataset-signature-v1', [canonicalJson(sorted)]);
  }

  async function computeRecordContentHash(record) {
    let input;
    if (Object.prototype.hasOwnProperty.call(record || {}, 'source_raw_text')) {
      input = { trace_id:record.trace_id, source_raw_text:record.source_raw_text, tags:record.tags || [] };
    } else if (Object.prototype.hasOwnProperty.call(record || {}, 'source_record')) {
      input = { trace_id:record.trace_id, source_record:record.source_record, source_record_display:record.source_record_display || null, tags:record.tags || [], source_row:record.source_row };
    } else throw new Error(`content_hash対象を判別できません: ${record?.trace_id || '(trace_idなし)'}`);
    return hashParts('content-hash-v1', [canonicalJson(input)]);
  }

  function pathMappingIssues(record) {
    return (record?.source_record_display_unresolved || []).filter(issue => issue?.reason === 'path_mapping_unsupported');
  }

  function diagnostic(code, side, detail, traceId, severity = 'error') {
    return { code, side, severity, trace_id:traceId || null, detail:String(detail || '') };
  }

  function isReady(diagnostics) { return !diagnostics.some(item => item.severity === 'error'); }

  async function bindSide(trace, annotation, expectedSide) {
    const diagnostics = [], notAnalyzed = [];
    const records = traceRecords(trace);
    if (!records) return blocked(expectedSide, [diagnostic('missing_trace_records', expectedSide, '_trace_records配列がありません')]);
    if (!annotation) return blocked(expectedSide, [diagnostic('missing_sidecar', expectedSide, '数量注釈sidecarが選択されていません')]);
    const schema = validateAnnotationSchema(annotation);
    if (!schema.valid) return blocked(expectedSide, schema.errors.map(error => diagnostic('schema_invalid', expectedSide, error)));
    if (annotation.side !== expectedSide) return blocked(expectedSide, [diagnostic('source_mismatch', expectedSide, `side=${annotation.side}、期待値=${expectedSide}`)]);

    const ruleset = validateRulesetCompatibility(annotation.ruleset_version);
    if (!ruleset.supported) {
      return blocked(expectedSide, [diagnostic('ruleset_mismatch', expectedSide, `非対応ruleset: ${canonicalJson(annotation.ruleset_version)} / 対応: ${canonicalJson(SUPPORTED_RULESETS)}`)]);
    }

    const traceDuplicates = duplicateIds(records);
    const annotationDuplicates = duplicateIds(annotation.records);
    traceDuplicates.forEach(id => diagnostics.push(diagnostic('duplicate_trace_id', expectedSide, `元trace内で重複: ${id}`, id)));
    annotationDuplicates.forEach(id => diagnostics.push(diagnostic('duplicate_annotation_id', expectedSide, `sidecar内で重複: ${id}`, id)));
    if (diagnostics.length) return blocked(expectedSide, diagnostics);

    const signature = await computeDatasetSignature(records);
    if (signature !== annotation.dataset_signature) return blocked(expectedSide, [diagnostic('source_mismatch', expectedSide, `dataset_signature不一致 (expected=${signature}, actual=${annotation.dataset_signature})`)], signature);

    const annotationById = new Map(annotation.records.map(record => [record.trace_id, record]));
    const traceById = new Map(records.map(record => [record.trace_id, record]));
    const bindings = [];
    for (const record of records) {
      const sideRecord = annotationById.get(record.trace_id);
      if (!sideRecord) {
        diagnostics.push(diagnostic('missing_annotation', expectedSide, '該当するsidecarレコードがありません', record.trace_id, 'warning'));
        notAnalyzed.push({ trace_id:record.trace_id, side:expectedSide, reason_code:'no_annotation', detail:'quantity-annotation側に該当trace_idがありません' });
        bindings.push({ trace_id:record.trace_id, status:'missing', annotation:null });
        continue;
      }
      let actualHash;
      try { actualHash = await computeRecordContentHash(record); }
      catch (error) {
        diagnostics.push(diagnostic('content_hash_unverifiable', expectedSide, error.message, record.trace_id));
        bindings.push({ trace_id:record.trace_id, status:'unparsed', annotation:null });
        continue;
      }
      if (actualHash !== sideRecord.content_hash) {
        diagnostics.push(diagnostic('stale_annotation', expectedSide, `content_hash不一致 (expected=${actualHash}, actual=${sideRecord.content_hash})`, record.trace_id));
        bindings.push({ trace_id:record.trace_id, status:'stale_annotation', annotation:null });
        continue;
      }
      const unsupported = pathMappingIssues(record);
      if (unsupported.length) {
        diagnostics.push(diagnostic('path_mapping_unsupported', expectedSide, `${unsupported.length}件のパス形式列マッピングを解析できません`, record.trace_id));
        bindings.push({ trace_id:record.trace_id, status:'unparsed', annotation:null });
        continue;
      }
      bindings.push({ trace_id:record.trace_id, status:'bound', annotation:sideRecord });
    }
    for (const sideRecord of annotation.records) {
      if (!traceById.has(sideRecord.trace_id)) diagnostics.push(diagnostic('missing_trace', expectedSide, 'sidecarのtrace_idに対応する元レコードがありません', sideRecord.trace_id));
    }
    return { side:expectedSide, ready:isReady(diagnostics), dataset_signature:signature, ruleset_version:annotation.ruleset_version,
      bindings, diagnostics, not_analyzed:notAnalyzed, candidate_records:[], satisfaction_judgements:[] };
  }

  function blocked(side, diagnostics, signature) {
    return { side, ready:false, dataset_signature:signature || null, ruleset_version:null, bindings:[], diagnostics,
      not_analyzed:[], candidate_records:[], satisfaction_judgements:[] };
  }

  async function bindInputPair({ requirementTrace, requirementAnnotation, actualTrace, actualAnnotation }) {
    const requirement = await bindSide(requirementTrace, requirementAnnotation, 'requirement');
    const actual = await bindSide(actualTrace, actualAnnotation, 'actual');
    return { schema_version:'quantity-binding/phase-b1', ready:requirement.ready && actual.ready, requirement, actual,
      diagnostics:[...requirement.diagnostics, ...actual.diagnostics], not_analyzed:[...requirement.not_analyzed, ...actual.not_analyzed],
      comparison_candidates:[], satisfaction_judgements:[] };
  }

  function relationRefs(row) {
    return { requirement_trace_id:row?.requirement_trace_id || null, actual_trace_id:row?.actual_trace_id || null,
      matcher_a_id:row?.matcher_a_id || row?.A_ID || row?.['A_ID'] || null,
      matcher_b_id:row?.matcher_b_id || row?.B_ID || row?.['B_ID'] || null };
  }

  // ── Phase B-2: 次元候補生成（3.4節 段階1のみ）。段階2以降（設計特性候補・条件候補・
  // comparisonMode導出）は未実装のまま。次元が一致した組だけをcandidatesとして返し、
  // それ以外は全直積を作らずバケット単位でnot_analyzedへ圧縮する。 ──

  function bindingAnalysesByTraceId(sideResult) {
    const map = new Map();
    (sideResult?.bindings || []).forEach(binding => {
      if (binding.status === 'bound' && binding.annotation) map.set(binding.trace_id, binding.annotation.analyses || []);
    });
    return map;
  }

  // 「sidecar内で」の重複検知は側ごとに独立させる。要求側sidecarと実仕様側sidecarは別ファイルであり、
  // quantity_idは内容由来のハッシュのため、別ファイル同士がたまたま同じ値を持つことは
  // データ破損の兆候ではない（各ファイル内で一意であればよい）。
  function duplicateQuantityIds(analysesByTrace) {
    const seen = new Set(), duplicates = new Set();
    for (const analyses of analysesByTrace.values()) {
      for (const analysis of analyses) {
        const id = analysis?.quantity_id;
        if (!id) continue;
        if (seen.has(id)) duplicates.add(id);
        seen.add(id);
      }
    }
    return [...duplicates];
  }

  function dimensionOf(analysis) {
    const value = analysis?.quantity?.unit?.dimension;
    return typeof value === 'string' ? value.trim() : '';
  }

  function groupByDimension(entries) {
    const map = new Map();
    entries.forEach(({ quantity_id, dimension }) => {
      if (!map.has(dimension)) map.set(dimension, []);
      map.get(dimension).push(quantity_id);
    });
    return map;
  }

  function blockedDimensionResult(diagnostics) {
    return { ready:false, candidates:[], candidate_count:0, not_analyzed:[], excluded_pair_count:0, diagnostics };
  }

  function generateDimensionCandidates({ binding, relations }) {
    if (!binding || !binding.ready) {
      return blockedDimensionResult([{ code:'binding_not_ready', severity:'error', detail:'quantity_sidecar_binding_core.bindInputPair()がready:falseのため次元候補を生成できません' }]);
    }

    const reqAnalysesByTrace = bindingAnalysesByTraceId(binding.requirement);
    const actAnalysesByTrace = bindingAnalysesByTraceId(binding.actual);

    // 【必須修正3】sidecar内でquantity_idが重複した場合は、候補生成全体をここで停止する。
    const reqDuplicateIds = duplicateQuantityIds(reqAnalysesByTrace);
    const actDuplicateIds = duplicateQuantityIds(actAnalysesByTrace);
    if (reqDuplicateIds.length || actDuplicateIds.length) {
      const diagnostics = [
        ...reqDuplicateIds.map(id => ({ code:'duplicate_quantity_id', severity:'error', side:'requirement', quantity_id:id, detail:'要求側sidecar内でquantity_idが重複しています' })),
        ...actDuplicateIds.map(id => ({ code:'duplicate_quantity_id', severity:'error', side:'actual', quantity_id:id, detail:'実仕様側sidecar内でquantity_idが重複しています' })),
      ];
      return blockedDimensionResult(diagnostics);
    }

    const diagnostics = [];
    const notAnalyzed = [];
    let candidates = [];
    let excludedPairCount = 0;

    // 【必須修正2】同一の要求trace_id+実仕様trace_idを持つ照合行が複数存在する場合、
    // どちらの照合行を採用すべきか自明でないため、いずれからも候補を生成しない。
    const relationKey = row => `${row.requirement_trace_id}|${row.actual_trace_id}`;
    const relationCounts = new Map();
    (relations || []).forEach(row => {
      if (!row?.requirement_trace_id || !row?.actual_trace_id) return; // A未対応/B未参照はペア自体が存在しない
      const key = relationKey(row);
      relationCounts.set(key, (relationCounts.get(key) || 0) + 1);
    });
    const duplicateRelationKeys = new Set([...relationCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
    duplicateRelationKeys.forEach(key => {
      const [requirementTraceId, actualTraceId] = key.split('|');
      diagnostics.push({ code:'duplicate_relation_pair', severity:'warning', requirement_trace_id:requirementTraceId, actual_trace_id:actualTraceId,
        detail:'同一の要求trace_id+実仕様trace_idを持つ照合行が複数存在するため、いずれからも候補を生成しません' });
    });

    for (const row of (relations || [])) {
      if (!row?.requirement_trace_id || !row?.actual_trace_id) continue;
      if (duplicateRelationKeys.has(relationKey(row))) continue;

      const reqAnalyses = reqAnalysesByTrace.get(row.requirement_trace_id) || [];
      const actAnalyses = actAnalysesByTrace.get(row.actual_trace_id) || [];
      if (!reqAnalyses.length || !actAnalyses.length) continue; // 未結合(missing/stale/unparsed)・数量ゼロ件は対象外

      // 【必須修正4】dimensionが空文字・空白・未設定の数量は、他の解決可能な数量の処理を
      // 止めずにdimension_unavailableへ個別に送る(バケット圧縮の対象はN×M組み合わせだけであり、
      // 単一の数量自体の欠落は最大でも数量の総数でしか増えないため、圧縮の必要がない)。
      const usable = (analyses, side, traceId) => {
        const kept = [];
        analyses.forEach(analysis => {
          const dimension = dimensionOf(analysis);
          if (!dimension) {
            notAnalyzed.push({ side, trace_id:traceId, quantity_id:analysis?.quantity_id || null,
              reason_code:'dimension_unavailable', detail:'quantity.unit.dimensionが空です' });
            diagnostics.push({ code:'dimension_unavailable', severity:'warning', side, trace_id:traceId, quantity_id:analysis?.quantity_id || null });
          } else {
            kept.push({ quantity_id:analysis.quantity_id, dimension });
          }
        });
        return kept;
      };

      const reqUsable = usable(reqAnalyses, 'requirement', row.requirement_trace_id);
      const actUsable = usable(actAnalyses, 'actual', row.actual_trace_id);
      const reqByDim = groupByDimension(reqUsable);
      const actByDim = groupByDimension(actUsable);

      for (const [reqDim, reqIds] of reqByDim) {
        for (const [actDim, actIds] of actByDim) {
          if (reqDim === actDim) {
            for (const requirementQuantityId of reqIds) {
              for (const actualQuantityId of actIds) {
                candidates.push({
                  quantity_pair_id:`${requirementQuantityId}::${actualQuantityId}`,
                  requirement_quantity_id:requirementQuantityId, actual_quantity_id:actualQuantityId,
                  requirement_trace_id:row.requirement_trace_id, actual_trace_id:row.actual_trace_id,
                  matcher_a_id:row.matcher_a_id ?? null, matcher_b_id:row.matcher_b_id ?? null,
                  dimension:reqDim,
                });
              }
            }
          } else {
            // 【必須修正1】異次元の組み合わせは、個々のペアをnot_analyzedへ展開せず、
            // 次元バケット単位で1件の圧縮監査記録にする(20×20なら400件ではなく1件)。
            const pairCount = reqIds.length * actIds.length;
            excludedPairCount += pairCount;
            notAnalyzed.push({
              reason_code:'dimension_mismatch',
              requirement_quantity_ids:reqIds, actual_quantity_ids:actIds,
              requirement_dimension:reqDim, actual_dimension:actDim,
              excluded_pair_count:pairCount,
              requirement_trace_id:row.requirement_trace_id, actual_trace_id:row.actual_trace_id,
              matcher_a_id:row.matcher_a_id ?? null, matcher_b_id:row.matcher_b_id ?? null,
            });
          }
        }
      }
    }

    // 【必須修正3後半、防御的チェック】ここまでの重複排除(sidecar内quantity_id一意性、
    // 重複照合行の除外)が正しく機能していれば構造的に起こり得ないはずだが、念のため
    // 生成後のquantity_pair_id自体の重複も検査し、見つかった場合は該当候補をすべて除外する。
    const pairIdCounts = new Map();
    candidates.forEach(candidate => pairIdCounts.set(candidate.quantity_pair_id, (pairIdCounts.get(candidate.quantity_pair_id) || 0) + 1));
    const duplicatedPairIds = new Set([...pairIdCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id));
    duplicatedPairIds.forEach(id => diagnostics.push({ code:'duplicate_quantity_pair_id', severity:'warning', quantity_pair_id:id,
      detail:'生成後のquantity_pair_idが重複しています(防御的チェック)。該当候補をすべて除外します' }));
    candidates = candidates.filter(candidate => !duplicatedPairIds.has(candidate.quantity_pair_id));

    return { ready:isReady(diagnostics), candidates, candidate_count:candidates.length, not_analyzed:notAnalyzed,
      excluded_pair_count:excludedPairCount, diagnostics };
  }

  return Object.freeze({ SCHEMA_VERSION, SUPPORTED_RULESETS, validateAnnotationSchema, validateRulesetCompatibility,
    canonicalValue, canonicalJson, normalize, hashParts, computeDatasetSignature, computeRecordContentHash,
    traceRecords, bindSide, bindInputPair, relationRefs, generateDimensionCandidates });
});

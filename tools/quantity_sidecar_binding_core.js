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
        bindings.push({ trace_id:record.trace_id, status:'missing', annotation:null, record });
        continue;
      }
      let actualHash;
      try { actualHash = await computeRecordContentHash(record); }
      catch (error) {
        diagnostics.push(diagnostic('content_hash_unverifiable', expectedSide, error.message, record.trace_id));
        bindings.push({ trace_id:record.trace_id, status:'unparsed', annotation:null, record });
        continue;
      }
      if (actualHash !== sideRecord.content_hash) {
        diagnostics.push(diagnostic('stale_annotation', expectedSide, `content_hash不一致 (expected=${actualHash}, actual=${sideRecord.content_hash})`, record.trace_id));
        bindings.push({ trace_id:record.trace_id, status:'stale_annotation', annotation:null, record });
        continue;
      }
      const unsupported = pathMappingIssues(record);
      if (unsupported.length) {
        diagnostics.push(diagnostic('path_mapping_unsupported', expectedSide, `${unsupported.length}件のパス形式列マッピングを解析できません`, record.trace_id));
        bindings.push({ trace_id:record.trace_id, status:'unparsed', annotation:null, record });
        continue;
      }
      // record(元traceレコードそのもの)をbindingへ埋め込むことで、下流(generatePropertyResolutions()等)が
      // 別途渡されたtrace引数を信頼する必要をなくす。content_hashは直前でこのrecordから計算済みのため、
      // ここに埋め込まれるrecordは常にdataset_signature・content_hashの検証を通過した実体そのものである
      // (レビューで、bindingとは別にtrace引数を渡す設計だとPhase B-1の厳密結合を迂回できると指摘された)。
      bindings.push({ trace_id:record.trace_id, status:'bound', annotation:sideRecord, record });
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
  // comparisonMode導出）は未実装のまま。同次元・異次元とも数量IDの全直積を作らず、
  // 次元バケットとして返す。段階2以降はcandidate_bucketsを逐次走査して絞り込む。 ──

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

  function dimensionSideIndex(analysesByTrace, side) {
    const byTrace = new Map();
    for (const [traceId, analyses] of [...analysesByTrace.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
      const usable = [];
      const unavailable = [];
      for (const analysis of [...analyses].sort((a, b) => String(a?.quantity_id || '').localeCompare(String(b?.quantity_id || '')))) {
        const dimension = dimensionOf(analysis);
        if (!dimension) {
          unavailable.push({ side, trace_id:traceId, quantity_id:analysis?.quantity_id || null,
            reason_code:'dimension_unavailable', detail:'quantity.unit.dimensionが空です' });
        } else {
          usable.push({ quantity_id:analysis.quantity_id, dimension });
        }
      }
      byTrace.set(traceId, { byDimension:groupByDimension(usable), unavailable });
    }
    return byTrace;
  }

  function blockedDimensionResult(diagnostics) {
    return { ready:false, candidates:[], candidate_buckets:[], candidate_bucket_count:0, candidate_count:0,
      candidates_materialized:false, not_analyzed:[], excluded_pair_count:0, diagnostics };
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
    const candidateBuckets = [];
    let candidateCount = 0;
    let excludedPairCount = 0;

    // dimension索引と欠落情報はsidecar/trace単位で一度だけ構築する。照合行ループ内で
    // analysesを再走査しないため、同じtraceが複数相手と関係しても欠落診断は増殖しない。
    const reqDimensionIndex = dimensionSideIndex(reqAnalysesByTrace, 'requirement');
    const actDimensionIndex = dimensionSideIndex(actAnalysesByTrace, 'actual');
    const emittedUnavailable = new Set();
    const emitUnavailable = entry => {
      const key = JSON.stringify([entry.side, entry.trace_id, entry.quantity_id, entry.reason_code]);
      if (emittedUnavailable.has(key)) return;
      emittedUnavailable.add(key);
      notAnalyzed.push(entry);
      diagnostics.push({ code:'dimension_unavailable', severity:'warning', side:entry.side,
        trace_id:entry.trace_id, quantity_id:entry.quantity_id });
    };

    // 【必須修正2】同一の要求trace_id+実仕様trace_idを持つ照合行が複数存在する場合、
    // どちらの照合行を採用すべきか自明でないため、いずれからも候補を生成しない。
    const relationKey = row => JSON.stringify([row.requirement_trace_id, row.actual_trace_id]);
    const relationCounts = new Map();
    const relationByKey = new Map();
    (relations || []).forEach(row => {
      if (!row?.requirement_trace_id || !row?.actual_trace_id) return; // A未対応/B未参照はペア自体が存在しない
      const key = relationKey(row);
      relationCounts.set(key, (relationCounts.get(key) || 0) + 1);
      if (!relationByKey.has(key)) relationByKey.set(key, row);
    });
    const duplicateRelationKeys = new Set([...relationCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
    duplicateRelationKeys.forEach(key => {
      const row = relationByKey.get(key);
      diagnostics.push({ code:'duplicate_relation_pair', severity:'warning', requirement_trace_id:row.requirement_trace_id, actual_trace_id:row.actual_trace_id,
        detail:'同一の要求trace_id+実仕様trace_idを持つ照合行が複数存在するため、いずれからも候補を生成しません' });
    });

    for (const row of (relations || [])) {
      if (!row?.requirement_trace_id || !row?.actual_trace_id) continue;
      if (duplicateRelationKeys.has(relationKey(row))) continue;

      const reqTraceIndex = reqDimensionIndex.get(row.requirement_trace_id);
      const actTraceIndex = actDimensionIndex.get(row.actual_trace_id);
      if (!reqTraceIndex || !actTraceIndex) continue; // 未結合(missing/stale/unparsed)は対象外
      reqTraceIndex.unavailable.forEach(emitUnavailable);
      actTraceIndex.unavailable.forEach(emitUnavailable);
      const reqByDim = reqTraceIndex.byDimension;
      const actByDim = actTraceIndex.byDimension;
      if (!reqByDim.size || !actByDim.size) continue;

      for (const [reqDim, reqIds] of reqByDim) {
        for (const [actDim, actIds] of actByDim) {
          if (reqDim === actDim) {
            const pairCount = reqIds.length * actIds.length;
            candidateCount += pairCount;
            candidateBuckets.push({
              requirement_quantity_ids:reqIds, actual_quantity_ids:actIds,
              candidate_pair_count:pairCount, dimension:reqDim,
              requirement_trace_id:row.requirement_trace_id, actual_trace_id:row.actual_trace_id,
              matcher_a_id:row.matcher_a_id ?? null, matcher_b_id:row.matcher_b_id ?? null,
            });
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

    return { ready:isReady(diagnostics), candidates:[], candidate_buckets:candidateBuckets,
      candidate_bucket_count:candidateBuckets.length, candidate_count:candidateCount,
      candidates_materialized:false, not_analyzed:notAnalyzed, excluded_pair_count:excludedPairCount, diagnostics };
  }

  // quantity-annotation/1.0-rc1: 概念候補生成ライブラリ(移植、semantic_mapping_prototype.jsの
  // marginOf()・CONCEPT_DICTIONARY・generatePropertyCandidates()から一字一句移植。乖離検出は
  // quantity_annotation_ported_lib_check.jsで行う。改変禁止、移植元を直接編集してから再度移植すること)
  function marginOf(candidates) {
    if (!candidates || candidates.length === 0) return 0;
    if (candidates.length === 1) return candidates[0].confidence;
    return candidates[0].confidence - candidates[1].confidence;
  }

  const CONCEPT_DICTIONARY = [
    {
      concept_id: 'environment.ambient_operating_temperature',
      label: '周囲使用温度',
      expected_dimension: 'temperature',
      keywords: ['周囲温度', '使用温度', '運転温度'],
      tags: ['使用温度'],
    },
    {
      concept_id: 'performance.cooling_capacity',
      label: '冷房能力',
      expected_dimension: 'power',
      keywords: ['冷房能力', '冷却能力'],
      tags: ['冷房能力'],
    },
    {
      concept_id: 'power_supply.voltage',
      label: '電源電圧',
      expected_dimension: 'voltage',
      keywords: ['電源電圧', '定格電圧', '電源'],
      tags: ['電源電圧'],
    },
    {
      concept_id: 'power_supply.frequency',
      label: '周波数',
      expected_dimension: 'frequency',
      keywords: ['周波数'],
      tags: ['周波数'],
    },
    {
      concept_id: 'acoustics.operating_noise',
      label: '運転騒音',
      expected_dimension: 'sound_pressure_level',
      keywords: ['騒音値', '運転騒音', '騒音'],
      tags: ['騒音'],
    },
    {
      concept_id: 'maintenance.access_space',
      label: '保守作業スペース',
      expected_dimension: 'length',
      keywords: ['保守作業スペース', '保守スペース', '保守'],
      tags: ['保守性'],
    },
  ];

  // ── 概念候補の生成: unit.dimension一致 + 周辺語一致 + タグ一致を独立した根拠として積み上げる ──
  function generatePropertyCandidates(quantity, ctx) {
    const nearbyText = ctx.nearbyText || '';
    const tags = ctx.tags || [];
    const candidates = [];
    for (const concept of CONCEPT_DICTIONARY) {
      let score = 0;
      const evidence = [];
      if (quantity.unit.dimension === concept.expected_dimension) {
        score += 0.4;
        evidence.push(`単位次元一致: ${quantity.unit.dimension}`);
      }
      const kwHit = concept.keywords.find(k => nearbyText.includes(k));
      if (kwHit) {
        score += 0.35;
        evidence.push(`周辺語: ${kwHit}`);
      }
      const tagHit = concept.tags.find(t => tags.includes(t));
      if (tagHit) {
        score += 0.25;
        evidence.push(`タグ: ${tagHit}`);
      }
      if (score > 0) {
        candidates.push({ concept_id: concept.concept_id, label: concept.label, confidence: Math.min(0.99, score), evidence });
      }
    }
    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates;
  }
  // ── quantity-annotation/1.0-rc1: 概念候補生成ライブラリ(移植)ここまで ──

  // ── Phase B-2.2a: 数量ごとのproperty候補生成・解決状態の正規化。段階1
  // (generateDimensionCandidates())とは独立に、bindInputPair()で結合済みのanalysesだけを対象に、
  // 数量1件につきちょうど1回generatePropertyCandidates()を評価する(relationをまたいで再計算しない。
  // 呼び出し側はrelationループの中でside+quantity_idをキーにこの結果を引くだけでよい)。
  // concept間の結合・除外バケット化・数値比較・comparisonMode導出・充足判定はまだ行わない
  // (3.4節 段階2b以降、B-2.2a完了・レビュー承認後に着手する)。

  const PROPERTY_MANAGEMENT_FIELD_NAMES = new Set([
    'tags', 'unregistered_tags', 'review_status', 'review_method', 'reviewed_at', 'review_comment',
    'exclusion_reason', 'trace_id', 'content_hash', 'stable_uid', 'stable_key',
  ]);

  function isPropertyManagementField(key) {
    const k = String(key);
    if (PROPERTY_MANAGEMENT_FIELD_NAMES.has(k)) return true;
    return /^(No|ID|行番号)$/i.test(k) || /_id$/i.test(k) || /_hash$/i.test(k);
  }

  // PDF側(source_raw_text)はその段落・文自体をnearbyTextとする(数量自身がその文の一部であり、
  // 除外すべき「他列」という概念が存在しないため、これは意図した設計のまま)。Excel側
  // (source_record)は、数量が入っている列自体ではなく同じ行の他列(例:「設計項目」列の
  // "冷房能力")が概念の主な手がかりになるため、管理列に加えて対象数量自身の列
  // (sourceField、analysis.source_field)も除外して連結する(同じ行に複数の数量が別の列に
  // 存在する場合、各数量が「自分自身の値」ではなく「他の列」から手がかりを得るようにする。
  // 対象列を含めたまま全列を連結すると、同じ行の複数数量すべてが同一の(自分自身を含む)
  // nearbyTextを共有してしまい、generateIntervalSemanticsCandidates()用nearbyTextで
  // 一度発生した列見出し・他セル漏れ込みと同種の取り違えを起こしうる、とレビューで指摘された)。
  // generateIntervalSemanticsCandidates()用のnearbyText(対象セル自身のみに限定。
  // shadow_mode_integration_design.md 2.3節の訂正で、列見出し・他列の値をinterval_semantics
  // 候補へ混ぜてはいけないと確定した)とは別の用途であり、この関数はもっぱら概念(property)
  // 候補生成専用として意図的に別定義にしている。
  function nearbyTextForRecord(record, sourceField) {
    if (typeof record?.source_raw_text === 'string') return record.source_raw_text;
    if (record?.source_record && typeof record.source_record === 'object' && !Array.isArray(record.source_record)) {
      return Object.entries(record.source_record)
        .filter(([key]) => key !== sourceField && !isPropertyManagementField(key))
        .map(([, value]) => (typeof value === 'string' || typeof value === 'number') ? String(value) : '')
        .filter(Boolean)
        .join(' / ');
    }
    return '';
  }

  // bindSide()がbindings[]へ埋め込んだ元trace record(content_hash検証済み、bindSide()の
  // 修正でstatus:'bound'エントリへrecordを直接持たせるようにした)を、trace_idをキーに引く。
  // 呼び出し側が別途trace引数を渡す必要をなくし、Phase B-1で確定した厳密結合を迂回できない
  // ようにする(レビューで、bindingとは別のtraceを渡せてしまう=Phase B-1の検証を迂回できる、
  // 取り違えたtraceを渡せる、trace引数を省略しても静かに空文脈で候補生成が続く、という
  // 3つの具体的な迂回経路を指摘された)。
  function boundRecordsByTraceId(sideResult) {
    const map = new Map();
    (sideResult?.bindings || []).forEach(binding => {
      if (binding.status === 'bound' && binding.record) map.set(binding.trace_id, binding.record);
    });
    return map;
  }

  // resolved: 最上位候補の確信度がruleset.auto_applicable_thresholds.propertyConfidence以上、
  // かつmarginOf()がthresholds.margin以上(次点候補との差が十分)。候補が1件のみの場合は
  // marginOf()がその候補自身のconfidenceを返すため、実質propertyConfidence判定だけで決まる
  // (弱い1件だけの候補を安易にresolvedにしないための、既存の2つの閾値の組み合わせ)。
  // unavailable: 候補が1件もない。
  // ambiguous: 候補はあるがresolvedの条件を満たさない(確信度不足、または次点との僅差)。
  // 新しい閾値は発明せず、既存のruleset(AUTO_APPLICABLE_THRESHOLDS由来のmargin・
  // propertyConfidence)をそのまま使う(shadow_mode_integration_design.md 7節のmarginOf()
  // パターンをproperty_candidatesへ適用する、という元の設計をそのまま踏襲)。
  function resolvePropertyStatus(candidates, thresholds) {
    if (!candidates.length) return 'unavailable';
    const top = candidates[0];
    const margin = marginOf(candidates);
    if (top.confidence >= thresholds.propertyConfidence && margin >= thresholds.margin) return 'resolved';
    return 'ambiguous';
  }

  // binding.diagnostics/binding.not_analyzed(Phase B-1が既に保持しているpath_mapping_unsupported・
  // stale_annotation・no_annotation等、side・trace_idを含む具体的な診断)を、この関数独自の
  // binding_not_ready等のマーカーで置き換えず、必ず引き継ぐ(レビューで、ready:false時に元診断が
  // 消え「なぜ結合できないのか」という具体情報が失われると指摘された)。
  function blockedPropertyResult(diagnostics, binding) {
    return { ready:false, resolutions:[],
      diagnostics:[...diagnostics, ...(binding?.diagnostics || [])],
      not_analyzed:[...(binding?.not_analyzed || [])] };
  }

  function generatePropertyResolutions({ binding }) {
    if (!binding || !binding.ready) {
      return blockedPropertyResult([{ code:'binding_not_ready', severity:'error',
        detail:'quantity_sidecar_binding_core.bindInputPair()がready:falseのためproperty候補を生成できません' }], binding);
    }
    // 両側とも同じ検証済みrulesetを共有している前提(bindSide()がSUPPORTED_RULESETSとの
    // 完全一致を要求しているため、ready:trueならrequirement/actual双方の閾値は同一のはず)。
    // 念のため一方が欠けていても他方から解決できるようフォールバックする。
    const thresholds = binding.requirement?.ruleset_version?.auto_applicable_thresholds
      || binding.actual?.ruleset_version?.auto_applicable_thresholds;
    if (!thresholds) {
      return blockedPropertyResult([{ code:'ruleset_thresholds_unavailable', severity:'error',
        detail:'auto_applicable_thresholds(margin/propertyConfidence)を解決できません' }], binding);
    }

    // 【必須修正】段階1(generateDimensionCandidates())が既に持つsidecar内quantity_id重複検査を、
    // B-2.2a単独でも独立して実行する。generatePropertyResolutions()は公開関数として単独で
    // 呼び出せるため、「段階1が先に呼ばれて止まるから安全」という前提に依存してはいけない、
    // とレビューで指摘された。
    const reqAnalysesByTrace = bindingAnalysesByTraceId(binding.requirement);
    const actAnalysesByTrace = bindingAnalysesByTraceId(binding.actual);
    const reqDuplicateIds = duplicateQuantityIds(reqAnalysesByTrace);
    const actDuplicateIds = duplicateQuantityIds(actAnalysesByTrace);
    if (reqDuplicateIds.length || actDuplicateIds.length) {
      return blockedPropertyResult([
        ...reqDuplicateIds.map(id => ({ code:'duplicate_quantity_id', severity:'error', side:'requirement', quantity_id:id, detail:'要求側sidecar内でquantity_idが重複しています' })),
        ...actDuplicateIds.map(id => ({ code:'duplicate_quantity_id', severity:'error', side:'actual', quantity_id:id, detail:'実仕様側sidecar内でquantity_idが重複しています' })),
      ], binding);
    }

    const reqRecordsByTrace = boundRecordsByTraceId(binding.requirement);
    const actRecordsByTrace = boundRecordsByTraceId(binding.actual);

    const resolutions = [];
    const process = (analysesByTrace, recordsByTrace, side) => {
      for (const [traceId, analyses] of [...analysesByTrace.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
        const record = recordsByTrace.get(traceId);
        for (const analysis of [...analyses].sort((a, b) => String(a?.quantity_id || '').localeCompare(String(b?.quantity_id || '')))) {
          const ctx = { nearbyText:nearbyTextForRecord(record, analysis.source_field), tags:record?.tags || [] };
          const candidates = generatePropertyCandidates(analysis.quantity, ctx);
          const status = resolvePropertyStatus(candidates, thresholds);
          resolutions.push({
            side, trace_id:traceId, quantity_id:analysis.quantity_id, status,
            concept_id: status === 'resolved' ? candidates[0].concept_id : null,
            candidates,
          });
        }
      }
    };
    process(reqAnalysesByTrace, reqRecordsByTrace, 'requirement');
    process(actAnalysesByTrace, actRecordsByTrace, 'actual');

    return { ready:true, resolutions, diagnostics:[] };
  }

  return Object.freeze({ SCHEMA_VERSION, SUPPORTED_RULESETS, validateAnnotationSchema, validateRulesetCompatibility,
    canonicalValue, canonicalJson, normalize, hashParts, computeDatasetSignature, computeRecordContentHash,
    traceRecords, bindSide, bindInputPair, relationRefs, generateDimensionCandidates,
    CONCEPT_DICTIONARY, generatePropertyCandidates, generatePropertyResolutions });
});

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

  function deepFreeze(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  }

  // bindingへ埋め込む元trace record・sidecarレコードを不変スナップショット化する。
  // 参照のまま埋め込むと、bind()呼び出し後に呼び出し側が元のtrace/annotationオブジェクトを
  // 変更した場合、binding内の値も連動して変わってしまう(content_hash検証をすり抜けて
  // 検証済みでない内容が下流(generatePropertyResolutions()等)へ渡ることになる、とレビューで
  // 指摘された)。structuredClone()で複製し、再帰的にfreezeすることで、埋め込み後の
  // 外部からの変更(意図的・偶発的いずれも)を構造的に防ぐ。
  function snapshotValue(value) {
    if (value === null || value === undefined) return value;
    return deepFreeze(structuredClone(value));
  }

  // 【round3レビュー修正、重大1: TOCTOU】旧実装はcomputeDatasetSignature()/computeRecordContentHash()
  // というawaitを挟む非同期検証を先に行い、その後(bindings.push()の直前)になって初めて
  // snapshotValue()でrecord/annotationを複製していた。awaitで一度制御を手放している間に
  // 呼び出し側が元のtrace/annotationオブジェクトを書き換えれば、「検証に使ったデータ」と
  // 「bindingへ埋め込まれるデータ」が食い違いうる(検証はhash計算時点の内容に対して行われるが、
  // 埋め込みはその後の――場合によっては書き換え後の――内容になる)、とレビューで指摘された。
  // 修正: trace/annotationを、最初のawaitより前に同期的にスナップショット化し、以後は
  // 一切元のtrace/annotationへ触れず、このスナップショットだけを検証・埋め込み双方に使う。
  // これにより「schema検証・signature計算・content hash計算・binding生成」はすべて同一の
  // 不変な複製に対して行われることになり、以前のように後段でrecordごとsnapshotValue()する
  // 必要もなくなる(スナップショット済みツリーの部分木は既に不変なため)。
  async function bindSide(trace, annotation, expectedSide) {
    const diagnostics = [], notAnalyzed = [];
    const records = traceRecords(trace);
    if (!records) return blocked(expectedSide, [diagnostic('missing_trace_records', expectedSide, '_trace_records配列がありません')]);
    if (!annotation) return blocked(expectedSide, [diagnostic('missing_sidecar', expectedSide, '数量注釈sidecarが選択されていません')]);

    const snapTrace = snapshotValue(trace);
    const snapAnnotation = snapshotValue(annotation);
    const snapRecords = traceRecords(snapTrace);

    const schema = validateAnnotationSchema(snapAnnotation);
    if (!schema.valid) return blocked(expectedSide, schema.errors.map(error => diagnostic('schema_invalid', expectedSide, error)));
    if (snapAnnotation.side !== expectedSide) return blocked(expectedSide, [diagnostic('source_mismatch', expectedSide, `side=${snapAnnotation.side}、期待値=${expectedSide}`)]);

    const ruleset = validateRulesetCompatibility(snapAnnotation.ruleset_version);
    if (!ruleset.supported) {
      return blocked(expectedSide, [diagnostic('ruleset_mismatch', expectedSide, `非対応ruleset: ${canonicalJson(snapAnnotation.ruleset_version)} / 対応: ${canonicalJson(SUPPORTED_RULESETS)}`)]);
    }

    const traceDuplicates = duplicateIds(snapRecords);
    const annotationDuplicates = duplicateIds(snapAnnotation.records);
    traceDuplicates.forEach(id => diagnostics.push(diagnostic('duplicate_trace_id', expectedSide, `元trace内で重複: ${id}`, id)));
    annotationDuplicates.forEach(id => diagnostics.push(diagnostic('duplicate_annotation_id', expectedSide, `sidecar内で重複: ${id}`, id)));
    if (diagnostics.length) return blocked(expectedSide, diagnostics);

    const signature = await computeDatasetSignature(snapRecords);
    if (signature !== snapAnnotation.dataset_signature) return blocked(expectedSide, [diagnostic('source_mismatch', expectedSide, `dataset_signature不一致 (expected=${signature}, actual=${snapAnnotation.dataset_signature})`)], signature);

    const annotationById = new Map(snapAnnotation.records.map(record => [record.trace_id, record]));
    const traceById = new Map(snapRecords.map(record => [record.trace_id, record]));
    const bindings = [];
    for (const record of snapRecords) {
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
      // record・annotationはどちらも、関数冒頭で作った不変スナップショット(snapTrace/snapAnnotation)の
      // 部分木であり、既にdeepFreeze済みである。個別に再度snapshotValue()する必要はない。
      bindings.push({ trace_id:record.trace_id, status:'bound', annotation:sideRecord, record });
    }
    for (const sideRecord of snapAnnotation.records) {
      if (!traceById.has(sideRecord.trace_id)) diagnostics.push(diagnostic('missing_trace', expectedSide, 'sidecarのtrace_idに対応する元レコードがありません', sideRecord.trace_id));
    }
    // 【round3レビュー修正、重大2】戻り値全体(ruleset_version・bindings配列・各binding要素・
    // diagnostics・not_analyzedを含む)をdeepFreeze()する。旧実装はrecord/annotationという
    // 末端の値だけをsnapshotValue()していたが、それを包むbinding要素自体・bindings配列・
    // ruleset_version(以前はannotationへの生参照のままだった)・戻り値オブジェクト自体は
    // 可変のままだったため、呼び出し後に外側から書き換え可能だった、と指摘された。
    return deepFreeze({ side:expectedSide, ready:isReady(diagnostics), dataset_signature:signature, ruleset_version:snapAnnotation.ruleset_version,
      bindings, diagnostics, not_analyzed:notAnalyzed, candidate_records:[], satisfaction_judgements:[] });
  }

  function blocked(side, diagnostics, signature) {
    return deepFreeze({ side, ready:false, dataset_signature:signature || null, ruleset_version:null, bindings:[], diagnostics,
      not_analyzed:[], candidate_records:[], satisfaction_judgements:[] });
  }

  // 【round3レビュー修正、重大1】requirement側をawaitし終えてからactual側のbindSide()を
  // 開始する旧実装は、requirement側の非同期処理が続いている間、actual側の入力がまだ
  // スナップショット化されておらず、その間に呼び出し側がactual側の元データを書き換える
  // 余地があった、と指摘された。bindSide()は今や引数を最初のawaitより前に同期的に
  // スナップショット化するため、両方のPromiseを個別にawaitせず同時に発生させ、
  // Promise.all()でまとめて待つだけで、双方とも呼び出し直後の状態が確定するようになる。
  async function bindInputPair({ requirementTrace, requirementAnnotation, actualTrace, actualAnnotation }) {
    const requirementPromise = bindSide(requirementTrace, requirementAnnotation, 'requirement');
    const actualPromise = bindSide(actualTrace, actualAnnotation, 'actual');
    const [requirement, actual] = await Promise.all([requirementPromise, actualPromise]);
    return deepFreeze({ schema_version:'quantity-binding/phase-b1', ready:requirement.ready && actual.ready, requirement, actual,
      diagnostics:[...requirement.diagnostics, ...actual.diagnostics], not_analyzed:[...requirement.not_analyzed, ...actual.not_analyzed],
      comparison_candidates:[], satisfaction_judgements:[] });
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
  // marginOf()・hasOpposingEvidence()・CONCEPT_DICTIONARY・generatePropertyCandidates()から
  // 一字一句移植。乖離検出はquantity_annotation_ported_lib_check.jsで行う。改変禁止、
  // 移植元を直接編集してから再度移植すること)
  function marginOf(candidates) {
    if (!candidates || candidates.length === 0) return 0;
    if (candidates.length === 1) return candidates[0].confidence;
    return candidates[0].confidence - candidates[1].confidence;
  }
  function hasOpposingEvidence(candidates) {
    const top = candidates?.[0];
    return !!(top && top.evidence.some(e => e.effect === 'opposes'));
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
  // "冷房能力")が概念の主な手がかりになるため、管理列に加えて**その行に存在する全ての
  // 数量所在列**(quantitySourceFields、その行の全analysisのsource_field集合)を除外して
  // 連結する。当初は対象数量自身の列だけを除外していたが、同じ行に複数の数量が別の列に
  // 存在する場合、ある数量の解決に「別の数量自身の値」が周辺語として混入してしまう
  // (例: 検討結果A列の数量を解決する際、検討結果B列の値に別の概念のキーワードが
  // 偶然含まれていると、検討結果A自身とは無関係な概念候補が競合として現れてしまう)、
  // とレビューで指摘された。対象列を含めたまま全列を連結すると、同じ行の複数数量すべてが
  // 互いの値を周辺語として共有してしまい、generateIntervalSemanticsCandidates()用nearbyTextで
  // 一度発生した列見出し・他セル漏れ込みと同種の取り違えを起こしうる。
  // generateIntervalSemanticsCandidates()用のnearbyText(対象セル自身のみに限定。
  // shadow_mode_integration_design.md 2.3節の訂正で、列見出し・他列の値をinterval_semantics
  // 候補へ混ぜてはいけないと確定した)とは別の用途であり、この関数はもっぱら概念(property)
  // 候補生成専用として意図的に別定義にしている。
  function nearbyTextForRecord(record, quantitySourceFields) {
    if (typeof record?.source_raw_text === 'string') return record.source_raw_text;
    if (record?.source_record && typeof record.source_record === 'object' && !Array.isArray(record.source_record)) {
      return Object.entries(record.source_record)
        .filter(([key]) => !quantitySourceFields.has(key) && !isPropertyManagementField(key))
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

    // 【必須修正】bound状態のtrace_idに対応する元trace recordがbinding内に見つからない場合
    // (bindSide()経由で正しく生成されたbindingでは起こらないはずだが、手動構築したbinding等の
    // データ不整合に対する防御)、空文脈へ静かにフォールバックせずfail closedする、と指摘された。
    const missingRecordDiagnostics = [];
    const checkMissingRecords = (analysesByTrace, recordsByTrace, side) => {
      for (const traceId of analysesByTrace.keys()) {
        if (!recordsByTrace.has(traceId)) {
          missingRecordDiagnostics.push({ code:'bound_record_missing', severity:'error', side, trace_id:traceId,
            detail:'bound状態のtrace_idに対応する元trace recordがbinding内に見つかりません' });
        }
      }
    };
    checkMissingRecords(reqAnalysesByTrace, reqRecordsByTrace, 'requirement');
    checkMissingRecords(actAnalysesByTrace, actRecordsByTrace, 'actual');
    if (missingRecordDiagnostics.length) return blockedPropertyResult(missingRecordDiagnostics, binding);

    const resolutions = [];
    const process = (analysesByTrace, recordsByTrace, side) => {
      for (const [traceId, analyses] of [...analysesByTrace.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
        const record = recordsByTrace.get(traceId);
        // 【必須修正】その行(trace)に存在する全analysisのsource_fieldを、対象数量自身の列だけで
        // なく丸ごと除外集合にする(1行に複数の数量があるケースでの数量間の文脈漏れ込み防止)。
        const quantitySourceFields = new Set(analyses.map(a => a?.source_field).filter(Boolean));
        const ctx = { nearbyText:nearbyTextForRecord(record, quantitySourceFields), tags:record?.tags || [] };
        for (const analysis of [...analyses].sort((a, b) => String(a?.quantity_id || '').localeCompare(String(b?.quantity_id || '')))) {
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

    // 【必須修正】正常終了時もbinding.diagnostics/not_analyzed(missing_annotation等のwarning、
    // no_annotation等)を引き継ぐ。以前はready:true時に常にdiagnostics:[]を返しており、
    // Phase B-1が既に検出していた警告・未解析情報が呼び出し側から見えなくなっていた、と
    // 指摘された。
    return { ready:true, resolutions,
      diagnostics:[...(binding.diagnostics || [])], not_analyzed:[...(binding.not_analyzed || [])] };
  }

  // ── Phase B-2.2b: 段階1(次元一致バケット)と段階2a(数量ごとのproperty解決)の結果を突き合わせ、
  // concept_idが一致する数量ペアだけをcomparison候補として生成する(3.4節 段階2)。1つの
  // candidate_bucketsバケット内であっても数量ID数は無制限(200×200のような合成データも既存の
  // 次元候補回帰テストで確認済み)であるため、段階1と同様に個々のペアを総当たりで評価せず、
  // concept_idごとのグルーピングと候補上限で組み合わせ爆発を避ける。数値比較・comparisonMode
  // 導出・充足判定はまだ行わない(3.4節 段階3以降、未着手のまま)。
  //
  // 【round1レビュー修正、重大1: 全直積の中間生成】初回実装は`reqIds.length×actIds.length`の
  // ペアを配列へ一度すべて生成してからslice()していたため、candidateLimitを超えた分も含めて
  // O(バケット内数量数の2乗)のメモリ・時間を消費していた(200×200なら40,000件、5,000×5,000なら
  // 2,500万件を先に作ってから大半を捨てる)。これは段階1が防いだはずの組み合わせ爆発の再発であり、
  // 「全直積を中間配列として生成しない」という3.4節の契約に反する。修正: 直積を配列化せず、
  // ソート済みID列を二重ループで走査しながら上限に達した時点で即座に打ち切る(下記
  // emitConceptGroupCandidates())。
  const DEFAULT_COMPARISON_CANDIDATE_LIMIT = 50;
  // 【round1レビュー修正、重大2 → round2レビューで「全体上限の判定材料」自体が誤りと訂正】
  // per-group上限(candidateLimit)だけでは、バケット数・concept数が多いケースで合計候補数が
  // 際限なく積み上がりうる(candidateLimitは「1つの(bucket,concept_id)組あたりの上限」であり、
  // 全体の上限ではないと指摘された)。round1では全体の合計にも別途上限(totalCandidateLimit)を
  // 設けたが、その判定に使っていたのは「各グループをcandidateLimitで切り詰めた後」の実現候補数
  // だった。これでは(a) 1グループだけでcandidateLimitを超える巨大な入力が複数集まると、
  // 切り詰め後もなお大量の候補オブジェクトを生成してから最後に全破棄することになり性能保護に
  // ならない、(b) 多数の小さなグループ(例: 100グループ×潜在100件をcandidateLimit=1で切り詰め)
  // では実現後の合計(100件)が小さく見えるため、真の潜在合計(10,000件)が大きくてもtotalCandidateLimit
  // を回避できてしまう、という2つの穴が残る、とround2レビューで指摘された。修正: 判定対象を
  // 「切り詰め前の潜在ペア数(reqIds.length×actIds.length)を全グループにわたって合計した値」に
  // 変更し、候補オブジェクトを1件も生成しない段階(Pass 1)でこの合計とtotalCandidateLimitを
  // 比較するようにした(詳細はgenerateComparisonCandidates()本体のコメントを参照)。既定値も
  // 「実現候補数の上限」から「潜在ペア数合計の上限」へ意味が変わったことに合わせて500→2000へ
  // 引き上げた。
  // 【round3レビュー修正、重大1: 上限を2種類に分離】round2の`totalCandidateLimit`は「切り詰め前の
  // 潜在ペア数合計」を判定材料にしたが、上限値自体をMAX_SAFE_TOTAL_CANDIDATE_LIMIT=10,000,000まで
  // 許容していたため、たとえば1,000グループ×各グループの潜在1万件・candidateLimit=10,000・
  // totalCandidateLimit=10,000,000のような設定では、潜在合計チェックは通過するがPass 2で
  // 実際に1,000万件のcomparison candidateオブジェクトを実体化できてしまう、と指摘された。
  // 「探索空間(潜在ペア数)の大きさ」と「実際にメモリへ載せる候補オブジェクト数」は別の量であり、
  // 別々の上限で守る必要がある。修正:
  // - `totalCandidateLimit`: 実体化見込み件数(Σ min(potentialPairCount_i, candidateLimit)、
  //   =Pass 2が実際に生成するオブジェクト数の上限)の上限。実際にメモリへ載る量を直接制限するため、
  //   上限値自体も1レコードあたりの上限(candidateLimit)と同程度の桁に抑える
  //   (MAX_SAFE_TOTAL_CANDIDATE_LIMIT、後述)。
  // - `totalPotentialPairLimit`(新設): 切り詰め前の潜在ペア数合計の上限。Pass 1の集計自体は
  //   バケット数×concept数に比例するだけの軽い加算処理であり、この上限を大きくしても
  //   組み合わせ爆発には繋がらないため、大きめの値を許容する。
  const DEFAULT_TOTAL_COMPARISON_CANDIDATE_LIMIT = 2000;
  const DEFAULT_TOTAL_POTENTIAL_PAIR_LIMIT = 2000000;
  const MAX_SAFE_CANDIDATE_LIMIT = 10000;
  // 【round4レビュー修正、中3】totalCandidateLimitの検証上限は実際にメモリへ載り、UIへ表示
  // されうる候補オブジェクト数を直接制限する。ブラウザでの実測(ヒープ・テーブル描画等)による
  // 検証がまだできていないため、round3で設定した100,000は根拠なく大きすぎると指摘された。
  // Playwright等での実測が済むまでは、より保守的な10,000を上限とする。
  const MAX_SAFE_TOTAL_CANDIDATE_LIMIT = 10000;
  // totalPotentialPairLimitはPass 1の軽い集計(乗算・加算のみ、オブジェクト生成なし)にしか
  // 使われないため、totalCandidateLimitより大幅に大きい上限を許容してよい。
  const MAX_SAFE_TOTAL_POTENTIAL_PAIR_LIMIT = 1000000000;

  function isSafeLimit(value, max = MAX_SAFE_CANDIDATE_LIMIT) { return Number.isSafeInteger(value) && value >= 1 && value <= max; }

  function resolutionLookup(propertyResult) {
    const map = new Map();
    (propertyResult?.resolutions || []).forEach(r => map.set(`${r.side}:${r.quantity_id}`, r));
    return map;
  }

  // quantityIds(1バケット・1side分)を、B-2.2aの解決結果に基づき「resolved」はconcept_idごとの
  // Mapへ、それ以外(ambiguous/unavailable、および対応する解決結果自体が見つからない防御的ケース)は
  // unresolvedへ振り分ける。generatePropertyCandidates()自体はここでは一切呼び出さない
  // (呼び出し側が1回だけ計算したgeneratePropertyResolutions()の結果をMap参照するだけ)。
  function groupResolvedByConcept(quantityIds, side, resolutionByKey, unresolved) {
    const byConcept = new Map();
    for (const id of quantityIds) {
      const resolution = resolutionByKey.get(`${side}:${id}`);
      if (!resolution) { unresolved.push({ quantity_id:id, status:'missing_resolution' }); continue; }
      if (resolution.status !== 'resolved') { unresolved.push({ quantity_id:id, status:resolution.status }); continue; }
      if (!byConcept.has(resolution.concept_id)) byConcept.set(resolution.concept_id, []);
      byConcept.get(resolution.concept_id).push(id);
    }
    return byConcept;
  }

  // 【round4レビュー修正、重大1: confidence降順ソートを撤廃】旧実装は切り詰め時の順序基準として
  // reqIds/actIds全体をconfidence降順(同点はquantity_id昇順)へ複製・ソートしていた。しかし
  // (a) 1つのbound record内の全analysisがnearbyText/tagsを共有するため、同一バケット・同一side・
  // 同一conceptの候補間でconfidenceが実際に異なることは構造的に起こらず(常にconfidence同点)、
  // このソートは実質的にquantity_id昇順ソートと同じ結果しか生まないこと、(b) それにもかかわらず
  // candidateLimitの大きさに関わらずreqIds/actIds全体(たとえば片側50万件)を毎回複製・O(N log N)
  // ソートしており、totalCandidateLimit(実体化見込み件数の上限)がこの複製・ソート自体のコストを
  // 一切制限できていなかった、と指摘された(candidateLimit=50に抑えても、その前に50万要素の
  // 配列を複製・全件ソートしてしまう)。さらに、stage 1(generateDimensionCandidates()の
  // dimensionSideIndex())が既にanalysesをquantity_id昇順でソート済みであり、bucket.
  // requirement_quantity_ids/actual_quantity_idsはその順序を保ったまま届く。つまりreqIds/actIds
  // は呼び出し時点で既にquantity_id昇順ソート済みであり、独自にソートし直す必要が最初からなかった。
  // 修正: ソートを撤廃し、reqIds/actIdsをそのまま(既にソート済みの状態のまま)二重ループで
  // 走査し、candidateLimitに達した時点で即座に打ち切る。これによりこの関数の計算量は
  // O(candidateLimit)にとどまり、reqIds/actIdsの実際の長さに一切依存しなくなる。
  function emitConceptGroupCandidates(reqIds, actIds, conceptId, bucket, candidateLimit, comparisonCandidates) {
    let emitted = 0;
    outer:
    for (const reqId of reqIds) {
      for (const actId of actIds) {
        if (emitted >= candidateLimit) break outer;
        comparisonCandidates.push({
          requirement_quantity_id:reqId, actual_quantity_id:actId, concept_id:conceptId, dimension:bucket.dimension,
          requirement_trace_id:bucket.requirement_trace_id, actual_trace_id:bucket.actual_trace_id,
          matcher_a_id:bucket.matcher_a_id ?? null, matcher_b_id:bucket.matcher_b_id ?? null,
        });
        emitted++;
      }
    }
    return emitted;
  }

  // 【round1レビュー修正、重大3】binding.diagnostics/not_analyzedを常に引き継ぐ。初回実装は
  // binding.ready===falseの早期returnでbindingそのものをblockedComparisonResult()へ渡しておらず、
  // path_mapping_unsupported・source_mismatch・stale_annotation・ruleset_mismatch等、Phase B-1が
  // side・trace_id付きで検出済みの具体的な診断が消えていた(B-2.2aで一度修正したのと同じ欠陥の
  // 再発、と指摘された)。修正: bindingを必ず受け取り、dimensionResult/propertyResultが
  // まだ存在しない段階の早期returnでも、binding.diagnostics/not_analyzedだけは必ず引き継ぐ。
  function blockedComparisonResult(diagnostics, binding, dimensionResult, propertyResult) {
    return { ready:false, comparison_candidates:[], candidate_count:0, result_complete:false,
      diagnostics:[...diagnostics, ...(binding?.diagnostics || []), ...(dimensionResult?.diagnostics || []), ...(propertyResult?.diagnostics || [])],
      not_analyzed:[...(binding?.not_analyzed || []), ...(dimensionResult?.not_analyzed || []), ...(propertyResult?.not_analyzed || [])] };
  }

  function generateComparisonCandidates({ binding, relations,
    candidateLimit = DEFAULT_COMPARISON_CANDIDATE_LIMIT, totalCandidateLimit = DEFAULT_TOTAL_COMPARISON_CANDIDATE_LIMIT,
    totalPotentialPairLimit = DEFAULT_TOTAL_POTENTIAL_PAIR_LIMIT }) {
    // 【round1レビュー修正、中】candidateLimit/totalCandidateLimit/totalPotentialPairLimitを
    // 未検証のまま算術・比較へ使うと、負数・非整数・NaN・Infinity・文字列等で誤動作しうる
    // (呼び出し側がInfinity等を渡すだけで上限機構そのものを無効化できてしまう、と指摘された)。
    // それぞれ1以上・各自の安全な整数上限以下であることを検証し、不正ならfail closedする。
    if (!isSafeLimit(candidateLimit)) {
      return blockedComparisonResult([{ code:'candidate_limit_invalid', severity:'error',
        detail:`candidateLimitは1以上${MAX_SAFE_CANDIDATE_LIMIT}以下の安全な整数である必要があります(実際=${JSON.stringify(candidateLimit)})` }], binding, null, null);
    }
    if (!isSafeLimit(totalCandidateLimit, MAX_SAFE_TOTAL_CANDIDATE_LIMIT)) {
      return blockedComparisonResult([{ code:'total_candidate_limit_invalid', severity:'error',
        detail:`totalCandidateLimitは1以上${MAX_SAFE_TOTAL_CANDIDATE_LIMIT}以下の安全な整数である必要があります(実際=${JSON.stringify(totalCandidateLimit)})` }], binding, null, null);
    }
    if (!isSafeLimit(totalPotentialPairLimit, MAX_SAFE_TOTAL_POTENTIAL_PAIR_LIMIT)) {
      return blockedComparisonResult([{ code:'total_potential_pair_limit_invalid', severity:'error',
        detail:`totalPotentialPairLimitは1以上${MAX_SAFE_TOTAL_POTENTIAL_PAIR_LIMIT}以下の安全な整数である必要があります(実際=${JSON.stringify(totalPotentialPairLimit)})` }], binding, null, null);
    }
    if (!binding || !binding.ready) {
      return blockedComparisonResult([{ code:'binding_not_ready', severity:'error',
        detail:'quantity_sidecar_binding_core.bindInputPair()がready:falseのため比較候補を生成できません' }], binding, null, null);
    }
    // dimensionResult/propertyResultを呼び出し側からの別引数として受け取らず、必ずこの関数の
    // 内部で同じbindingから1回ずつ計算する(B-2.2a round1で見つかった、bindingとは別に渡された
    // 検証済みデータが実際のbindingと食い違いうる、という欠陥クラスをここで再発させないための
    // 意図的な設計判断。詳細はshadow_mode_integration_design.md 3.4節の訂正を参照)。
    const dimensionResult = generateDimensionCandidates({ binding, relations });
    if (!dimensionResult.ready) {
      return blockedComparisonResult([{ code:'dimension_candidates_not_ready', severity:'error',
        detail:'generateDimensionCandidates()がready:falseのため比較候補を生成できません' }], binding, dimensionResult, null);
    }
    const propertyResult = generatePropertyResolutions({ binding });
    if (!propertyResult.ready) {
      return blockedComparisonResult([{ code:'property_resolutions_not_ready', severity:'error',
        detail:'generatePropertyResolutions()がready:falseのため比較候補を生成できません' }], binding, dimensionResult, propertyResult);
    }

    const resolutionByKey = resolutionLookup(propertyResult);
    const notAnalyzed = [];
    const diagnostics = [];

    // ── 【round2/round3レビュー修正、重大1・重大2・重大3】Pass 1: 候補オブジェクトを1件も
    // 生成せず、concept一致するグループの記述子(reqIds/actIds/potentialPairCount)だけを集める。
    // potentialPairCountはreqIds.length×actIds.lengthの乗算のみで、直積そのものは走査・生成
    // しないため、この段階の計算量はO(バケット数×concept数)にとどまる(バケット内の数量数が
    // どれだけ大きくても定数時間)。
    // 【round3レビュー修正、重大2】さらに、潜在ペア数合計(totalPotentialPairCount)・実体化見込み
    // 件数合計(totalMaterializedUpperBound、=Σ min(potentialPairCount_i, candidateLimit)、
    // Pass 2が実際に生成するオブジェクト数の上限)のいずれかが対応する上限を超えた時点で、
    // バケットの走査そのものを即座に打ち切る(labeled break)。round2の実装は全バケットを
    // 走査し終えてからまとめて判定していたため、上限超過が確定した後も残りすべてのバケットに
    // ついて数量ID再走査・conceptグルーピング・記述子の蓄積・not_analyzed生成を続けており、
    // 無駄な走査が残っていた、と指摘された。 ──
    // 【round4レビュー修正、重大2】バケットの走査順がdimensionResult.candidate_buckets(=relations
    // 引数の配列順をそのまま引き継ぐ)に依存していたため、同じrelations集合でも配列順を変えるだけで
    // 「どのグループまで走査したか」「打ち切り時点の観測値」「打ち切りに巻き込まれたグループ」が
    // 変わってしまっていた、と指摘された。修正: Pass 1へ入る前に、requirement_trace_id→
    // actual_trace_id→dimensionの安定キーでバケットを並べ替える。これにより、同じrelations集合
    // であれば入力順に関わらず常に同じバケットが先に走査され、早期打ち切りの結果(打ち切り時点の
    // 観測値・巻き込まれたグループ)が再現可能になる。
    const sortedBuckets = [...dimensionResult.candidate_buckets].sort((a, b) => {
      const byReq = String(a.requirement_trace_id).localeCompare(String(b.requirement_trace_id));
      if (byReq !== 0) return byReq;
      const byAct = String(a.actual_trace_id).localeCompare(String(b.actual_trace_id));
      if (byAct !== 0) return byAct;
      return String(a.dimension).localeCompare(String(b.dimension));
    });

    const groupDescriptors = [];
    let totalPotentialPairCount = 0;
    let totalMaterializedUpperBound = 0;
    let limitExceededKinds = null; // ['materialized'] / ['potential'] / ['materialized','potential'] / null(未超過)
    let processedBucketCount = 0;

    bucketScan:
    for (const bucket of sortedBuckets) {
      processedBucketCount++;
      const reqUnresolved = [];
      const actUnresolved = [];
      const reqByConcept = groupResolvedByConcept(bucket.requirement_quantity_ids, 'requirement', resolutionByKey, reqUnresolved);
      const actByConcept = groupResolvedByConcept(bucket.actual_quantity_ids, 'actual', resolutionByKey, actUnresolved);

      const emitUnresolved = (list, side) => {
        const byStatus = new Map();
        list.forEach(({ quantity_id, status }) => {
          if (!byStatus.has(status)) byStatus.set(status, []);
          byStatus.get(status).push(quantity_id);
        });
        for (const [status, ids] of byStatus) {
          notAnalyzed.push({ reason_code:'property_unresolved', side, status, quantity_ids:[...ids].sort(),
            requirement_trace_id:bucket.requirement_trace_id, actual_trace_id:bucket.actual_trace_id,
            matcher_a_id:bucket.matcher_a_id ?? null, matcher_b_id:bucket.matcher_b_id ?? null });
        }
      };
      emitUnresolved(reqUnresolved, 'requirement');
      emitUnresolved(actUnresolved, 'actual');

      const allConceptIds = [...new Set([...reqByConcept.keys(), ...actByConcept.keys()])].sort();
      for (const conceptId of allConceptIds) {
        const reqIds = reqByConcept.get(conceptId);
        const actIds = actByConcept.get(conceptId);
        if (reqIds && actIds) {
          const potentialPairCount = reqIds.length * actIds.length;
          const materializedUpperBound = Math.min(potentialPairCount, candidateLimit);
          totalPotentialPairCount += potentialPairCount;
          totalMaterializedUpperBound += materializedUpperBound;
          groupDescriptors.push({ reqIds, actIds, conceptId, bucket, potentialPairCount });
          // 【round4レビュー修正、中1】両方の上限を同じ加算後にそれぞれ独立して評価し、
          // 同時に超過した場合は両方のkindを記録する(片方だけ記録すると診断が不完全になる、
          // と指摘された)。
          const exceededKinds = [];
          if (totalMaterializedUpperBound > totalCandidateLimit) exceededKinds.push('materialized');
          if (totalPotentialPairCount > totalPotentialPairLimit) exceededKinds.push('potential');
          if (exceededKinds.length) { limitExceededKinds = exceededKinds; break bucketScan; }
        } else if (reqIds) {
          notAnalyzed.push({ reason_code:'concept_mismatch', side:'requirement', concept_id:conceptId, quantity_ids:[...reqIds].sort(),
            requirement_trace_id:bucket.requirement_trace_id, actual_trace_id:bucket.actual_trace_id,
            matcher_a_id:bucket.matcher_a_id ?? null, matcher_b_id:bucket.matcher_b_id ?? null });
        } else if (actIds) {
          notAnalyzed.push({ reason_code:'concept_mismatch', side:'actual', concept_id:conceptId, quantity_ids:[...actIds].sort(),
            requirement_trace_id:bucket.requirement_trace_id, actual_trace_id:bucket.actual_trace_id,
            matcher_a_id:bucket.matcher_a_id ?? null, matcher_b_id:bucket.matcher_b_id ?? null });
        }
      }
    }

    // ── いずれかの上限を超えた場合、候補オブジェクトを1件も生成せずfail closedする(どのグループ
    // 由来の候補を残すかという恣意的な判断を避けるため)。バケット走査自体を打ち切っているため、
    // groupDescriptorsには走査済みのバケット分しか含まれない(=以後のバケットの潜在ペア数は
    // 合計に反映されていないが、既に上限超過が確定しているため計算する必要がない)。
    // 【round3レビュー修正、中1】この経路では実際には1件も候補を生成していないため、
    // 「切り詰めました」「超過分を除外しました」という(部分的に成功したかのような)表現は
    // 事実と一致しない、と指摘された。修正: 走査済みの各グループのうち、per-group上限を
    // 超えていた(=生成していれば切り詰められていたはずの)ものは、`candidate_limit_exceeded`
    // (実際に切り詰めが起きた場合専用のreason_code)ではなく`candidate_limit_would_exceed`
    // (実体化していれば超過していたはずという仮定の監査記録)として、`materialized_pair_count:0`
    // を明示して記録する。diagnostics配列への個別warning追加は行わない(全体のerror診断1件で
    // 十分であり、実体化していないのに「切り詰めた」というwarningを積み増すと事実と食い違うため)。 ──
    if (limitExceededKinds) {
      groupDescriptors.forEach(({ conceptId, bucket, potentialPairCount }) => {
        if (potentialPairCount > candidateLimit) {
          notAnalyzed.push({ reason_code:'candidate_limit_would_exceed', concept_id:conceptId,
            requirement_trace_id:bucket.requirement_trace_id, actual_trace_id:bucket.actual_trace_id,
            matcher_a_id:bucket.matcher_a_id ?? null, matcher_b_id:bucket.matcher_b_id ?? null,
            potential_pair_count:potentialPairCount, candidate_limit:candidateLimit, materialized_pair_count:0 });
        }
      });
      // 【round4レビュー修正、重大2】observed_*_at_stopという名前で、これが「入力全体の合計」では
      // なく「バケット走査を打ち切った時点までの部分集計」であることをフィールド名自体で明示する
      // (旧`total_potential_pair_count`等の名前は、あたかも入力全体の総計であるかのように誤解
      // されうる、と指摘された)。unscanned_bucket_countが0でない限り、これらは部分集計である。
      const limitNames = limitExceededKinds.map(kind => kind === 'materialized' ? 'totalCandidateLimit' : 'totalPotentialPairLimit');
      const unscannedBucketCount = sortedBuckets.length - processedBucketCount;
      diagnostics.push({ code:'total_candidate_limit_exceeded', severity:'error',
        detail:`比較候補の累計(バケット走査を打ち切った時点の値。実体化見込み=${totalMaterializedUpperBound}、潜在=${totalPotentialPairCount})が${limitNames.join('・')}を超えたため、候補を1件も生成せず停止しました(走査済み${processedBucketCount}/${sortedBuckets.length}バケット、未走査${unscannedBucketCount}バケット)` });
      notAnalyzed.push({ reason_code:'total_candidate_limit_exceeded', limit_kinds:limitExceededKinds,
        observed_potential_pair_count_at_stop:totalPotentialPairCount,
        observed_materialized_upper_bound_at_stop:totalMaterializedUpperBound,
        total_candidate_limit:totalCandidateLimit, total_potential_pair_limit:totalPotentialPairLimit,
        processed_bucket_count:processedBucketCount, total_bucket_count:sortedBuckets.length,
        unscanned_bucket_count:unscannedBucketCount });
      const combinedDiagnostics = [...(dimensionResult.diagnostics || []), ...(propertyResult.diagnostics || []), ...diagnostics];
      return { ready:isReady(combinedDiagnostics), comparison_candidates:[], candidate_count:0, result_complete:false,
        diagnostics:combinedDiagnostics,
        not_analyzed:[...(dimensionResult.not_analyzed || []), ...(propertyResult.not_analyzed || []), ...notAnalyzed] };
    }

    // ── Pass 2: 潜在合計がtotalCandidateLimit以内であることを確認できたので、ここで初めて
    // 実際の候補オブジェクトを生成する(1グループあたりcandidateLimit件まで)。 ──
    const comparisonCandidates = [];
    let anyGroupTruncated = false;
    for (const { reqIds, actIds, conceptId, bucket, potentialPairCount } of groupDescriptors) {
      const emitted = emitConceptGroupCandidates(reqIds, actIds, conceptId, bucket, candidateLimit, comparisonCandidates);
      if (potentialPairCount > emitted) {
        anyGroupTruncated = true;
        const excludedCount = potentialPairCount - emitted;
        diagnostics.push({ code:'candidate_limit_exceeded', severity:'warning', concept_id:conceptId,
          requirement_trace_id:bucket.requirement_trace_id, actual_trace_id:bucket.actual_trace_id,
          detail:`候補上限(${candidateLimit})を超えたため、超過分(${excludedCount}件)を切り詰めました` });
        notAnalyzed.push({ reason_code:'candidate_limit_exceeded', concept_id:conceptId,
          requirement_trace_id:bucket.requirement_trace_id, actual_trace_id:bucket.actual_trace_id,
          matcher_a_id:bucket.matcher_a_id ?? null, matcher_b_id:bucket.matcher_b_id ?? null,
          excluded_pair_count:excludedCount });
      }
    }

    // ── 【round2レビュー修正、重大2】per-group上限による切り詰めは、3.4節6番が元々想定していた
    // 「打ち切りと、打ち切ったこと自体を診断情報に残す」という設計のまま維持する(1件の異常な
    // レコードのために比較実行全体を止めると、他の無関係な正常レコードの結果まで失われてしまう
    // ため。レビューでも「完全にfail closedする方が単純で安全」としつつ、「result_complete:falseを
    // 追加し後段が不完全候補集合を確定結果として扱わない契約にする」という代替案自体は認めていた)。
    // ただし、打ち切りが発生した=候補集合が完全ではないことを、diagnostics/not_analyzedを
    // 読まなくても機械的に検知できるよう、result_completeフィールドを新設した。段階3以降
    // (条件候補の整合・comparisonMode導出・数値比較)が実装される際は、result_complete===falseの
    // 結果を確定結果として扱わない契約とする。 ──
    const combinedDiagnostics = [...(dimensionResult.diagnostics || []), ...(propertyResult.diagnostics || []), ...diagnostics];
    return { ready:isReady(combinedDiagnostics), comparison_candidates:comparisonCandidates,
      candidate_count:comparisonCandidates.length, result_complete:!anyGroupTruncated, diagnostics:combinedDiagnostics,
      not_analyzed:[...(dimensionResult.not_analyzed || []), ...(propertyResult.not_analyzed || []), ...notAnalyzed] };
  }

  // ── Phase B-2.3a 段階1: 数量ごとのinterval_semantics_candidates解決。この候補配列自体は
  // Phase A抽出時に既に計算されbindSide()が埋め込んだ不変ツリーの一部として届いており
  // (quantity_annotation_schema_v1.json 2.3節、analysis.interval_semantics_candidates)、
  // ここで再生成はしない(generatePropertyResolutions()がconcept候補をgeneratePropertyCandidates()
  // で毎回再計算するのとは対照的。区間意味候補は既存の語彙・スコアリング規則に基づき
  // Phase Aで既に確定しているため、比較段階が担うのは既存候補の閾値判定による正規化だけである)。
  // comparisonMode導出(deriveComparisonModeCandidate())・数値比較・区間比較・充足判定は
  // 本段階では一切行わない(3.4節 段階3以降、未着手のまま)。 ──

  // 【レビュー修正、中1】interval_semantics_candidatesの`value`はJSON Schema上は任意の非空文字列
  // であり(quantity_annotation_schema_v1.json、enum制約なし)、resolveConditionStatus()が
  // confidence/marginだけで判定すると、ruleset v2.19が実際には生成し得ない未知の文字列や、
  // 「候補が弱い場合の受け皿」でしかない'unknown'自体が、たまたま高いconfidenceを持つ形で
  // 格納された場合にresolvedへ昇格してしまう(COMPARISON_MODE_DERIVATION_TABLE・
  // deriveComparisonModeCandidate()は'unknown'を明示的に導出対象から除外する契約であり、
  // 「resolvedかつvalue:'unknown'」は下流の契約と矛盾する)。ruleset v2.19の
  // REQUIREMENT_SEMANTICS_RULES・ACTUAL_SEMANTICS_RULES・CONDITION_SEMANTICS_RULES
  // (semantic_mapping_prototype.js 83-213行目)が実際に生成しうるvalueの全体をallowlist化し、
  // 'unknown'(常設の受け皿、実際の意味区分ではない)を含め、この集合に無い値は最上位候補で
  // あってもresolvedにしない(曖昧候補を推測で一意化しないのと同じ理由で、未知語を推測で
  // 「使える値」と扱わない)。ルール自体を変更した場合はこの集合も追随して更新すること
  // (quantity_condition_candidate_verification.jsに、既知の全語彙がresolved可能であることを
  // 確認する回帰テストがある)。
  const KNOWN_CONDITION_SEMANTICS_VALUES = new Set([
    'required_capability_domain', 'acceptable_region', 'achieved_point', 'capability_domain',
    'outcome_range', 'guaranteed_minimum', 'guaranteed_maximum', 'aggregated_representative_value',
    'test_condition',
  ]);

  // resolvePropertyStatus()と同型だが、閾値はpropertyConfidenceではなくmodeConfidenceを使う
  // (AUTO_APPLICABLE_THRESHOLDSはproperty候補とinterval_semantics候補とで確信度閾値を
  // 別々に持ち、margin閾値だけを共有する設計になっている。semantic_mapping_prototype.js
  // evaluateAutoApplicable()参照)。resolved: 最上位候補がKNOWN_CONDITION_SEMANTICS_VALUES
  // に含まれる既知の値であり、かつconfidenceがmodeConfidence以上、かつmarginOf()がmargin以上。
  // unavailable: 候補が0件(スキーマ上は空配列も許容されるため防御的に扱うが、
  // generateIntervalSemanticsCandidates()は常にunknownの受け皿候補を含めるため実運用では
  // 起こらない見込み)。ambiguous: それ以外(confidence/margin不足、または最上位候補が
  // 'unknown'・未知語のいずれか)。新しい閾値は発明しない。
  function resolveConditionStatus(candidates, thresholds) {
    if (!candidates.length) return 'unavailable';
    const top = candidates[0];
    if (!KNOWN_CONDITION_SEMANTICS_VALUES.has(top.value)) return 'ambiguous';
    const margin = marginOf(candidates);
    if (top.confidence >= thresholds.modeConfidence && margin >= thresholds.margin) return 'resolved';
    return 'ambiguous';
  }

  // interval_semantics_candidatesはPhase Aのscoresemantics()がconfidence降順で生成する契約だが
  // (semantic_mapping_prototype.js scoreSemantics()末尾の.sort())、JSON Schemaはこの順序を
  // 強制していない。resolveConditionStatus()の正しさは「先頭要素が最上位候補である」ことに
  // 依存するため、外部データの順序をそのまま信頼せず、ここで確信度降順に並べ直してから使う
  // (元の配列は不変スナップショットの一部のため複製してからソートする)。
  // 【レビュー修正、中2】confidenceが同点の候補同士は、単純な.sort()では入力配列内の元の順序
  // (=sidecar生成側の実装依存、呼び出し側からは非決定的に見える)がそのまま保たれてしまう
  // (Array.prototype.sortは安定ソートのため)。判定結果(status/value)自体はconfidenceの値だけで
  // 決まり同点候補の順序には依存しないが、resolutions[].candidatesという監査用の出力配列の
  // 順序が入力順に依存すると、スナップショット比較等での再現性を損なう。value昇順を
  // 決定的なtie-breakとして追加する。
  function sortedByConfidenceDesc(candidates) {
    return [...candidates].sort((a, b) => (b.confidence - a.confidence) || String(a.value).localeCompare(String(b.value)));
  }

  // 【レビュー修正、重大1】interval_semantics_candidatesはJSON Schema上、配列サイズに上限がない
  // (maxItems未設定)。既知語彙(KNOWN_CONDITION_SEMANTICS_VALUES、9種)+unknownの受け皿を
  // 前提にすれば実際に生成される候補数はせいぜい10件程度だが、スキーマはこれを保証しないため、
  // スキーマ上有効なsidecarへ1数量あたり極端に大きな候補配列を格納できてしまう。この検査を
  // 経ないままsortedByConfidenceDesc()で複製・全件ソートすると、B-2.2bが直積生成に対して
  // 行った組み合わせ爆発対策と同種の、未対策な計算コストが生じる。上限検査は複製・ソートより
  // 前に行い、超過時はready:falseで即座に停止する(1件の異常な数量のために結合全体の信頼性が
  // 疑わしくなるため、B-2.2bのcandidateLimitのような部分的切り詰めではなく、
  // duplicate_quantity_id等と同じ「構造的な入力異常」として扱う)。
  const MAX_INTERVAL_SEMANTICS_CANDIDATES_PER_QUANTITY = 64;

  // 【レビュー修正、修正順3】interval_semantics_candidates内で同じvalueが複数回現れることは、
  // 正しい生成元(semantic_mapping_prototype.jsのscoreSemantics()、valueごとにMapで集約するため
  // 構造的に重複しない)では起こらない契約になっている。それでもスキーマ自体はこれを禁止して
  // いないため、値の重複自体を「本来ありえない=信頼できない入力」の兆候として検査し、
  // 上限検査と同じ理由でfail closedする(件数・重複のいずれも、複製・ソート前の軽い1回走査で
  // 検査できるため、性能への影響はない)。
  function validateIntervalSemanticsCandidates(analysesByTrace, side, diagnostics) {
    for (const [traceId, analyses] of analysesByTrace) {
      for (const analysis of analyses) {
        const candidates = analysis.interval_semantics_candidates || [];
        if (candidates.length > MAX_INTERVAL_SEMANTICS_CANDIDATES_PER_QUANTITY) {
          diagnostics.push({ code:'condition_candidate_limit_exceeded', severity:'error', side, trace_id:traceId, quantity_id:analysis.quantity_id,
            observed_count:candidates.length, limit:MAX_INTERVAL_SEMANTICS_CANDIDATES_PER_QUANTITY,
            detail:`interval_semantics_candidatesの件数(${candidates.length})が上限(${MAX_INTERVAL_SEMANTICS_CANDIDATES_PER_QUANTITY})を超えています` });
          continue; // 上限超過が確定した配列を、重複検査のためだけにさらに全走査しない
        }
        const seen = new Set();
        for (const candidate of candidates) {
          if (seen.has(candidate.value)) {
            diagnostics.push({ code:'condition_candidate_duplicate_value', severity:'error', side, trace_id:traceId, quantity_id:analysis.quantity_id,
              value:candidate.value, detail:`interval_semantics_candidates内でvalue"${candidate.value}"が重複しています` });
          }
          seen.add(candidate.value);
        }
      }
    }
  }

  function blockedConditionResult(diagnostics, binding) {
    return { ready:false, resolutions:[],
      diagnostics:[...diagnostics, ...(binding?.diagnostics || [])],
      not_analyzed:[...(binding?.not_analyzed || [])] };
  }

  function generateConditionResolutions({ binding }) {
    if (!binding || !binding.ready) {
      return blockedConditionResult([{ code:'binding_not_ready', severity:'error',
        detail:'quantity_sidecar_binding_core.bindInputPair()がready:falseのため条件候補を解決できません' }], binding);
    }
    const thresholds = binding.requirement?.ruleset_version?.auto_applicable_thresholds
      || binding.actual?.ruleset_version?.auto_applicable_thresholds;
    if (!thresholds) {
      return blockedConditionResult([{ code:'ruleset_thresholds_unavailable', severity:'error',
        detail:'auto_applicable_thresholds(modeConfidence/margin)を解決できません' }], binding);
    }

    // 段階1(generateDimensionCandidates())・B-2.2a(generatePropertyResolutions())と同じく、
    // sidecar内quantity_id重複検査をこの関数単独でも独立して実行する(公開関数として単独で
    // 呼び出せるため、「他の関数が先に呼ばれて止まるから安全」という前提に依存しない)。
    const reqAnalysesByTrace = bindingAnalysesByTraceId(binding.requirement);
    const actAnalysesByTrace = bindingAnalysesByTraceId(binding.actual);
    const reqDuplicateIds = duplicateQuantityIds(reqAnalysesByTrace);
    const actDuplicateIds = duplicateQuantityIds(actAnalysesByTrace);
    if (reqDuplicateIds.length || actDuplicateIds.length) {
      return blockedConditionResult([
        ...reqDuplicateIds.map(id => ({ code:'duplicate_quantity_id', severity:'error', side:'requirement', quantity_id:id, detail:'要求側sidecar内でquantity_idが重複しています' })),
        ...actDuplicateIds.map(id => ({ code:'duplicate_quantity_id', severity:'error', side:'actual', quantity_id:id, detail:'実仕様側sidecar内でquantity_idが重複しています' })),
      ], binding);
    }

    // 【レビュー修正、重大1・修正順3】複製・ソートより前に、件数上限・value重複を検査する。
    const validationDiagnostics = [];
    validateIntervalSemanticsCandidates(reqAnalysesByTrace, 'requirement', validationDiagnostics);
    validateIntervalSemanticsCandidates(actAnalysesByTrace, 'actual', validationDiagnostics);
    if (validationDiagnostics.length) return blockedConditionResult(validationDiagnostics, binding);

    const resolutions = [];
    const process = (analysesByTrace, side) => {
      for (const [traceId, analyses] of [...analysesByTrace.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))) {
        for (const analysis of [...analyses].sort((a, b) => String(a?.quantity_id || '').localeCompare(String(b?.quantity_id || '')))) {
          const candidates = sortedByConfidenceDesc(analysis.interval_semantics_candidates || []);
          const status = resolveConditionStatus(candidates, thresholds);
          // 【レビュー修正、重大2】status/valueの2フィールドだけでは、下流(将来のcomparisonMode
          // 自動適用判定、semantic_mapping_prototype.js evaluateAutoApplicable()参照)が安全性
          // 判断に使うmargin・否定根拠の有無が失われる。resolutionは既にcandidates(evidence込み)
          // を保持しているため導出は可能だが、都度導出させず、evaluateAutoApplicable()が
          // 実際に必要とする形のまま明示フィールドとして保持する
          // (evaluateAutoApplicable()自体が使うextractionWarningsCountは、interval_semantics
          // 候補とは無関係なanalysis.quantity.extraction.warnings由来のため、この関数の関心事
          // ではなく含めない。下流はbinding経由で直接参照できる)。
          resolutions.push({
            side, trace_id:traceId, quantity_id:analysis.quantity_id, status,
            value: status === 'resolved' ? candidates[0].value : null,
            top_confidence: candidates.length ? candidates[0].confidence : null,
            margin: marginOf(candidates),
            has_opposing_evidence: hasOpposingEvidence(candidates),
            candidates,
          });
        }
      }
    };
    process(reqAnalysesByTrace, 'requirement');
    process(actAnalysesByTrace, 'actual');

    // B-2.2a generatePropertyResolutions()と同じく、binding.diagnostics/not_analyzed
    // (path_mapping_unsupported・stale_annotation・no_annotation等)を正常終了時も引き継ぐ。
    return { ready:true, resolutions,
      diagnostics:[...(binding.diagnostics || [])], not_analyzed:[...(binding.not_analyzed || [])] };
  }

  // ── Phase B-2.3a 段階2: B-2.2b比較候補へ両側(requirement/actual)の条件解決結果を付加する。
  // comparisonResult/conditionResultは呼び出し側から別引数として受け取らず、必ずこの関数の
  // 内部で同じbindingから計算する(B-2.2a round1・B-2.2b全体で確立した「検証済み結果を
  // 呼び出し側から別途受け取らない」設計をここでも踏襲する。呼び出し側が実際のbindingとは
  // 食い違うcomparisonResultを渡せてしまう迂回経路を最初から塞ぐ)。
  //
  // レビューで明示された必須要件: comparisonResult.ready !== trueまたは
  // comparisonResult.result_complete !== trueの場合は必ずfail closedする(B-2.2b承認時に
  // 「段階3以降の関数はresult_complete===trueを要求し、これを段階3の最初の回帰テストとして
  // 固定すべき」と指摘された契約を、この最初の段階3関数で実装する)。
  //
  // comparisonMode導出・単位変換・数値比較・区間比較・充足判定はまだ行わない。 ──

  function conditionResolutionLookup(conditionResult) {
    const map = new Map();
    (conditionResult?.resolutions || []).forEach(r => map.set(`${r.side}:${r.quantity_id}`, r));
    return map;
  }

  // comparisonResult.diagnostics/not_analyzedとconditionResult.diagnostics/not_analyzedは、
  // どちらも内部でbinding.diagnostics/not_analyzedを引き継いでいる(前者はgeneratePropertyResolutions()
  // 経由、後者はgenerateConditionResolutions()自身)。単純に連結すると同じbinding由来の診断が
  // 二重に現れるため、内容一致(canonicalJson)で重複除去してから返す。
  function dedupeByCanonicalJson(items) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
      const key = canonicalJson(item);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  function blockedConditionAnnotatedResult(diagnostics, binding, comparisonResult, conditionResult) {
    return { ready:false, comparison_candidates:[], candidate_count:0, result_complete:false,
      diagnostics:dedupeByCanonicalJson([...diagnostics, ...(binding?.diagnostics || []), ...(comparisonResult?.diagnostics || []), ...(conditionResult?.diagnostics || [])]),
      not_analyzed:dedupeByCanonicalJson([...(binding?.not_analyzed || []), ...(comparisonResult?.not_analyzed || []), ...(conditionResult?.not_analyzed || [])]) };
  }

  function generateConditionAnnotatedComparisonCandidates({ binding, relations,
    candidateLimit = DEFAULT_COMPARISON_CANDIDATE_LIMIT, totalCandidateLimit = DEFAULT_TOTAL_COMPARISON_CANDIDATE_LIMIT,
    totalPotentialPairLimit = DEFAULT_TOTAL_POTENTIAL_PAIR_LIMIT }) {
    const comparisonResult = generateComparisonCandidates({ binding, relations, candidateLimit, totalCandidateLimit, totalPotentialPairLimit });
    if (comparisonResult.ready !== true || comparisonResult.result_complete !== true) {
      return blockedConditionAnnotatedResult([{ code:'comparison_candidates_not_ready_or_incomplete', severity:'error',
        detail:`generateComparisonCandidates()がready=${JSON.stringify(comparisonResult.ready)}、result_complete=${JSON.stringify(comparisonResult.result_complete)}のため条件付き比較候補を生成できません(段階3以降はready===trueかつresult_complete===trueを要求してfail closedする契約)` }],
        binding, comparisonResult, null);
    }

    const conditionResult = generateConditionResolutions({ binding });
    if (conditionResult.ready !== true) {
      return blockedConditionAnnotatedResult([{ code:'condition_resolutions_not_ready', severity:'error',
        detail:'generateConditionResolutions()がready:falseのため条件付き比較候補を生成できません' }],
        binding, comparisonResult, conditionResult);
    }

    const conditionByKey = conditionResolutionLookup(conditionResult);
    // 段階1はbindingに結合済みの全数量を漏れなく処理するため、comparisonResult.comparison_candidates
    // が参照するquantity_idは構造上すべて段階1の結果に存在するはずである。それでも「渡された
    // データを無条件に信頼しない」という原則により、対応する条件解決結果が見つからない場合は
    // 静かに既定値へフォールバックせず、fail closedする(generatePropertyResolutions()の
    // bound_record_missing検査と同じ防御パターン)。
    const missingConditionDiagnostics = [];
    const annotated = comparisonResult.comparison_candidates.map(candidate => {
      const reqCondition = conditionByKey.get(`requirement:${candidate.requirement_quantity_id}`);
      const actCondition = conditionByKey.get(`actual:${candidate.actual_quantity_id}`);
      if (!reqCondition || !actCondition) {
        missingConditionDiagnostics.push({ code:'condition_resolution_missing', severity:'error',
          requirement_quantity_id:candidate.requirement_quantity_id, actual_quantity_id:candidate.actual_quantity_id,
          detail:'比較候補のquantity_idに対応する条件解決結果が見つかりません' });
        return null;
      }
      // 【レビュー修正、重大2】status/valueの2フィールドだけを付加すると、後段の安全判定
      // (margin・否定根拠の有無)に必要な情報が失われる(generateConditionResolutions()の
      // コメント参照)。候補・evidence配列を丸ごとペア数分複製すると重くなるため、
      // evaluateAutoApplicable()が実際に必要とするスカラー値(top_confidence・margin・
      // has_opposing_evidence)だけを既存のstatus/valueと同じ扁平フィールドとして付加する。
      return { ...candidate,
        requirement_condition_status:reqCondition.status, requirement_condition_value:reqCondition.value,
        requirement_condition_top_confidence:reqCondition.top_confidence, requirement_condition_margin:reqCondition.margin,
        requirement_condition_has_opposing_evidence:reqCondition.has_opposing_evidence,
        actual_condition_status:actCondition.status, actual_condition_value:actCondition.value,
        actual_condition_top_confidence:actCondition.top_confidence, actual_condition_margin:actCondition.margin,
        actual_condition_has_opposing_evidence:actCondition.has_opposing_evidence };
    });
    if (missingConditionDiagnostics.length) {
      return blockedConditionAnnotatedResult(missingConditionDiagnostics, binding, comparisonResult, conditionResult);
    }

    return { ready:true, comparison_candidates:annotated, candidate_count:annotated.length, result_complete:true,
      diagnostics:dedupeByCanonicalJson([...comparisonResult.diagnostics, ...conditionResult.diagnostics]),
      not_analyzed:dedupeByCanonicalJson([...comparisonResult.not_analyzed, ...conditionResult.not_analyzed]) };
  }

  return Object.freeze({ SCHEMA_VERSION, SUPPORTED_RULESETS, validateAnnotationSchema, validateRulesetCompatibility,
    canonicalValue, canonicalJson, normalize, hashParts, computeDatasetSignature, computeRecordContentHash,
    traceRecords, bindSide, bindInputPair, relationRefs, generateDimensionCandidates,
    CONCEPT_DICTIONARY, generatePropertyCandidates, generatePropertyResolutions,
    DEFAULT_COMPARISON_CANDIDATE_LIMIT, DEFAULT_TOTAL_COMPARISON_CANDIDATE_LIMIT, DEFAULT_TOTAL_POTENTIAL_PAIR_LIMIT,
    generateComparisonCandidates, generateConditionResolutions, generateConditionAnnotatedComparisonCandidates });
});

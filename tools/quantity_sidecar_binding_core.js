/* quantity-annotation/1.0-rc1 strict binding core.
 * Browser/Node shared, dependency-free in the browser.  This phase validates and
 * binds sources only; it deliberately does not generate quantity pairs, numeric
 * comparisons, or satisfaction judgements.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.QuantitySidecarBinding = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const SCHEMA_VERSION = 'quantity-annotation/1.0-rc1';
  const ROOT_KEYS = new Set([
    'schema_version', 'side', 'source_trace_file', 'hash_algorithm', 'id_hash_algorithm',
    'dataset_signature', 'generated_at', 'generator', 'ruleset_version', 'records',
    'column_role_candidates'
  ]);
  const ROOT_REQUIRED = [...ROOT_KEYS].filter(k => k !== 'column_role_candidates');

  function typeName(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function add(errors, path, message) {
    errors.push(`${path}: ${message}`);
  }

  // Compiled validation for quantity_annotation_schema_v1.json.  Keep this
  // deliberately strict at the binding boundary: an invalid document is never
  // partially consumed.
  function validateAnnotationSchema(doc) {
    const errors = [];
    if (!isObject(doc)) return { valid:false, errors:['$: type不一致 (objectが必要)'] };
    ROOT_REQUIRED.forEach(k => { if (!(k in doc)) add(errors, '$', `必須フィールド不足: ${k}`); });
    Object.keys(doc).forEach(k => { if (!ROOT_KEYS.has(k)) add(errors, '$', `未定義フィールド(additionalProperties:false): ${k}`); });
    if (doc.schema_version !== SCHEMA_VERSION) add(errors, '$.schema_version', `const不一致: ${SCHEMA_VERSION}`);
    if (!['requirement', 'actual'].includes(doc.side)) add(errors, '$.side', 'enum不一致');
    if (typeof doc.source_trace_file !== 'string' || !doc.source_trace_file.length) add(errors, '$.source_trace_file', '1文字以上のstringが必要');
    if (doc.hash_algorithm !== 'SHA-256') add(errors, '$.hash_algorithm', 'const不一致: SHA-256');
    if (doc.id_hash_algorithm !== 'SHA-256/128') add(errors, '$.id_hash_algorithm', 'const不一致: SHA-256/128');
    if (!/^QA-SHA256:[0-9a-f]{64}$/.test(doc.dataset_signature || '')) add(errors, '$.dataset_signature', 'pattern不一致');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(doc.generated_at || '')) add(errors, '$.generated_at', 'ISO UTC日時が必要');
    if (!isObject(doc.generator) || typeof doc.generator.tool !== 'string' || !doc.generator.tool.length || typeof doc.generator.version !== 'string' || !doc.generator.version.length) add(errors, '$.generator', 'tool/versionが必要');
    else Object.keys(doc.generator).forEach(k => { if (!['tool', 'version'].includes(k)) add(errors, '$.generator', `未定義フィールド: ${k}`); });
    const rv = doc.ruleset_version;
    if (!isObject(rv) || typeof rv.quantity_extraction !== 'string' || !rv.quantity_extraction.length || typeof rv.semantics_rules !== 'string' || !rv.semantics_rules.length || !isObject(rv.auto_applicable_thresholds)) {
      add(errors, '$.ruleset_version', 'quantity_extraction/semantics_rules/auto_applicable_thresholdsが必要');
    } else {
      Object.keys(rv).forEach(k => { if (!['quantity_extraction', 'semantics_rules', 'auto_applicable_thresholds'].includes(k)) add(errors, '$.ruleset_version', `未定義フィールド: ${k}`); });
      Object.keys(rv.auto_applicable_thresholds).forEach(k => { if (!['modeConfidence', 'margin', 'propertyConfidence'].includes(k)) add(errors, '$.ruleset_version.auto_applicable_thresholds', `未定義フィールド: ${k}`); });
      ['modeConfidence', 'margin', 'propertyConfidence'].forEach(k => {
        const value = rv.auto_applicable_thresholds[k];
        if (typeof value !== 'number' || value < 0 || value > 1) add(errors, `$.ruleset_version.auto_applicable_thresholds.${k}`, '0以上1以下のnumberが必要');
      });
    }
    if (!Array.isArray(doc.records)) add(errors, '$.records', `type不一致 (arrayが必要、実際=${typeName(doc.records)})`);
    else doc.records.forEach((record, i) => validateRecord(record, `$.records[${i}]`, errors));
    if ('column_role_candidates' in doc && !Array.isArray(doc.column_role_candidates)) add(errors, '$.column_role_candidates', 'arrayが必要');
    else (doc.column_role_candidates || []).forEach((column, i) => {
      if (!isObject(column) || typeof column.column !== 'string' || !column.column.length || !Array.isArray(column.role_candidates)) add(errors, `$.column_role_candidates[${i}]`, 'column/role_candidatesが必要');
      else column.role_candidates.forEach((candidate, j) => {
        if (!isObject(candidate) || !['baseline_design', 'resolved_design', 'unknown'].includes(candidate.role) || typeof candidate.confidence !== 'number' || candidate.confidence < 0 || candidate.confidence > 1 || !Array.isArray(candidate.evidence)) add(errors, `$.column_role_candidates[${i}].role_candidates[${j}]`, 'role/confidence/evidenceが不正');
      });
    });
    return { valid:errors.length === 0, errors };
  }

  function validateRecord(record, path, errors) {
    if (!isObject(record)) { add(errors, path, 'objectが必要'); return; }
    const allowed = new Set(['trace_id', 'content_hash', 'analyses']);
    Object.keys(record).forEach(k => { if (!allowed.has(k)) add(errors, path, `未定義フィールド(additionalProperties:false): ${k}`); });
    if (typeof record.trace_id !== 'string' || !record.trace_id.length) add(errors, `${path}.trace_id`, '1文字以上のstringが必要');
    if (!/^[0-9a-f]{64}$/.test(record.content_hash || '')) add(errors, `${path}.content_hash`, '64桁の小文字hexが必要');
    if (!Array.isArray(record.analyses)) add(errors, `${path}.analyses`, 'arrayが必要');
    else record.analyses.forEach((analysis, i) => validateAnalysis(analysis, `${path}.analyses[${i}]`, errors));
  }

  function validateAnalysis(analysis, path, errors) {
    if (!isObject(analysis)) { add(errors, path, 'objectが必要'); return; }
    const allowed = new Set(['quantity_id', 'source_field', 'occurrence_index', 'source_span', 'normalized_text', 'quantity', 'interval_semantics_candidates', 'is_condition_value', 'source_representation', 'source_value_text']);
    Object.keys(analysis).forEach(k => { if (!allowed.has(k)) add(errors, path, `未定義フィールド(additionalProperties:false): ${k}`); });
    ['quantity_id', 'source_field', 'occurrence_index', 'source_span', 'normalized_text', 'quantity', 'interval_semantics_candidates'].forEach(k => {
      if (!(k in analysis)) add(errors, path, `必須フィールド不足: ${k}`);
    });
    if (!/^q-[0-9a-f]{32}$/.test(analysis.quantity_id || '')) add(errors, `${path}.quantity_id`, 'q- + 32桁hexが必要');
    if (typeof analysis.source_field !== 'string' || !analysis.source_field.length) add(errors, `${path}.source_field`, '1文字以上のstringが必要');
    if (!Number.isInteger(analysis.occurrence_index) || analysis.occurrence_index < 0) add(errors, `${path}.occurrence_index`, '0以上のintegerが必要');
    validateSpan(analysis.source_span, `${path}.source_span`, errors);
    if (typeof analysis.normalized_text !== 'string') add(errors, `${path}.normalized_text`, 'stringが必要');
    validateQuantityRecord(analysis.quantity, `${path}.quantity`, errors);
    if (!Array.isArray(analysis.interval_semantics_candidates)) add(errors, `${path}.interval_semantics_candidates`, 'arrayが必要');
    else analysis.interval_semantics_candidates.forEach((candidate, i) => {
      const p = `${path}.interval_semantics_candidates[${i}]`;
      if (!isObject(candidate)) { add(errors, p, 'objectが必要'); return; }
      Object.keys(candidate).forEach(k => { if (!['value', 'confidence', 'evidence'].includes(k)) add(errors, p, `未定義フィールド: ${k}`); });
      if (typeof candidate.value !== 'string' || !candidate.value.length || typeof candidate.confidence !== 'number' || candidate.confidence < 0 || candidate.confidence > 1 || !Array.isArray(candidate.evidence)) add(errors, p, 'value/confidence/evidenceが不正');
      else candidate.evidence.forEach((evidence, j) => {
        if (!isObject(evidence) || typeof evidence.type !== 'string' || !evidence.type.length || typeof evidence.value !== 'string' || !evidence.value.length || typeof evidence.source_text !== 'string' || !['supports', 'opposes'].includes(evidence.effect) || typeof evidence.weight !== 'number') add(errors, `${p}.evidence[${j}]`, 'evidence itemが不正');
      });
    });
    if ('is_condition_value' in analysis && typeof analysis.is_condition_value !== 'boolean') add(errors, `${path}.is_condition_value`, 'booleanが必要');
    if ('source_representation' in analysis && !['raw_value', 'formatted_display'].includes(analysis.source_representation)) add(errors, `${path}.source_representation`, 'enum不一致');
    if ('source_value_text' in analysis && typeof analysis.source_value_text !== 'string') add(errors, `${path}.source_value_text`, 'stringが必要');
  }

  function validateQuantityRecord(record, path, errors) {
    if (!isObject(record)) { add(errors, path, 'objectが必要'); return; }
    ['source_text', 'quantity', 'unit', 'extraction'].forEach(k => { if (!(k in record)) add(errors, path, `必須フィールド不足: ${k}`); });
    if (typeof record.source_text !== 'string') add(errors, `${path}.source_text`, 'stringが必要');
    if ('source_span' in record) validateSpan(record.source_span, `${path}.source_span`, errors);
    if ('normalized_text' in record && typeof record.normalized_text !== 'string') add(errors, `${path}.normalized_text`, 'stringが必要');
    const quantity = record.quantity;
    if (!isObject(quantity) || !['interval', 'alternatives'].includes(quantity.kind)) add(errors, `${path}.quantity`, 'intervalまたはalternativesが必要');
    else if (quantity.kind === 'interval') {
      Object.keys(quantity).forEach(k => { if (!['kind', 'lower', 'upper'].includes(k)) add(errors, `${path}.quantity`, `未定義フィールド: ${k}`); });
      ['lower', 'upper'].forEach(k => {
        if (!(k in quantity)) add(errors, `${path}.quantity`, `必須フィールド不足: ${k}`);
        else validateBound(quantity[k], `${path}.quantity.${k}`, errors);
      });
    } else {
      Object.keys(quantity).forEach(k => { if (!['kind', 'options', 'selection_semantics'].includes(k)) add(errors, `${path}.quantity`, `未定義フィールド: ${k}`); });
      if (!Array.isArray(quantity.options) || typeof quantity.selection_semantics !== 'string' || !quantity.selection_semantics.length) add(errors, `${path}.quantity`, 'options/selection_semanticsが必要');
    }
    if (!isObject(record.unit) || typeof record.unit.source !== 'string' || typeof record.unit.canonical !== 'string' || typeof record.unit.dimension !== 'string') add(errors, `${path}.unit`, 'source/canonical/dimensionが必要');
    else if ('standard_ref' in record.unit && record.unit.standard_ref !== null && !isObject(record.unit.standard_ref)) add(errors, `${path}.unit.standard_ref`, 'objectまたはnullが必要');
    if (!isObject(record.extraction) || typeof record.extraction.confidence !== 'number' || record.extraction.confidence < 0 || record.extraction.confidence > 1 || !Array.isArray(record.extraction.warnings)) add(errors, `${path}.extraction`, 'confidence/warningsが必要');
    if ('context' in record && !isObject(record.context)) add(errors, `${path}.context`, 'objectが必要');
    if ('condition_candidates' in record && !Array.isArray(record.condition_candidates)) add(errors, `${path}.condition_candidates`, 'arrayが必要');
  }

  function validateBound(bound, path, errors) {
    if (bound === null) return;
    if (!isObject(bound)) { add(errors, path, 'objectまたはnullが必要'); return; }
    Object.keys(bound).forEach(k => { if (!['value', 'inclusive'].includes(k)) add(errors, path, `未定義フィールド: ${k}`); });
    if (typeof bound.value !== 'number' || typeof bound.inclusive !== 'boolean') add(errors, path, 'value(number)/inclusive(boolean)が必要');
  }

  function validateSpan(span, path, errors) {
    if (!isObject(span) || !Number.isInteger(span.start) || span.start < 0 || !Number.isInteger(span.end) || span.end < 0) add(errors, path, 'start/endは0以上のintegerが必要');
  }

  function normalize(value) {
    return String(value == null ? '' : value).normalize('NFKC').replace(/\r\n?/g, '\n')
      .split('\n').map(line => line.replace(/[ \t]+$/g, '')).join('\n').replace(/[ \t]+/g, ' ').trim();
  }

  function canonicalValue(value) {
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonicalValue(value[k])]));
    return value;
  }

  function canonicalJson(value) { return JSON.stringify(canonicalValue(value)); }

  async function sha256(value) {
    const text = String(value);
    if (typeof process !== 'undefined' && process.versions?.node && typeof require === 'function') {
      return require('crypto').createHash('sha256').update(text, 'utf8').digest('hex');
    }
    if (!globalThis.crypto?.subtle) throw new Error('SHA-256を利用できません。');
    const bytes = new TextEncoder().encode(text);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function hashParts(namespace, parts) {
    return sha256([namespace, ...parts.map(normalize)].join(String.fromCharCode(0)));
  }

  function traceRecords(trace) {
    if (Array.isArray(trace?._trace_records)) return trace._trace_records;
    if (Array.isArray(trace)) return trace;
    return null;
  }

  function duplicateIds(records) {
    const seen = new Set(), duplicates = new Set();
    (records || []).forEach(r => {
      const id = typeof r?.trace_id === 'string' ? r.trace_id : '';
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
    } else {
      throw new Error(`content_hash対象を判別できません: ${record?.trace_id || '(trace_idなし)'}`);
    }
    return hashParts('content-hash-v1', [canonicalJson(input)]);
  }

  function pathMappingIssues(record) {
    return (record?.source_record_display_unresolved || []).filter(issue => issue?.reason === 'path_mapping_unsupported');
  }

  function diagnostic(code, side, detail, traceId) {
    return { code, side, severity:'error', trace_id:traceId || null, detail:String(detail || '') };
  }

  async function bindSide(trace, annotation, expectedSide) {
    const diagnostics = [];
    const records = traceRecords(trace);
    if (!records) {
      diagnostics.push(diagnostic('missing_trace_records', expectedSide, '_trace_records配列がありません'));
      return blocked(expectedSide, diagnostics);
    }
    if (!annotation) {
      diagnostics.push(diagnostic('missing_sidecar', expectedSide, '数量注釈sidecarが選択されていません'));
      return blocked(expectedSide, diagnostics);
    }
    const schema = validateAnnotationSchema(annotation);
    if (!schema.valid) {
      schema.errors.forEach(error => diagnostics.push(diagnostic('schema_invalid', expectedSide, error)));
      return blocked(expectedSide, diagnostics);
    }
    if (annotation.side !== expectedSide) {
      diagnostics.push(diagnostic('source_mismatch', expectedSide, `side=${annotation.side}、期待値=${expectedSide}`));
      return blocked(expectedSide, diagnostics);
    }
    const traceDuplicates = duplicateIds(records);
    traceDuplicates.forEach(id => diagnostics.push(diagnostic('duplicate_trace_id', expectedSide, `元trace内で重複: ${id}`, id)));
    const annotationDuplicates = duplicateIds(annotation.records);
    annotationDuplicates.forEach(id => diagnostics.push(diagnostic('duplicate_annotation_id', expectedSide, `sidecar内で重複: ${id}`, id)));
    if (traceDuplicates.length || annotationDuplicates.length) return blocked(expectedSide, diagnostics);

    const signature = await computeDatasetSignature(records);
    if (signature !== annotation.dataset_signature) {
      diagnostics.push(diagnostic('source_mismatch', expectedSide, `dataset_signature不一致 (expected=${signature}, actual=${annotation.dataset_signature})`));
      return blocked(expectedSide, diagnostics, signature);
    }

    const annotationById = new Map(annotation.records.map(r => [r.trace_id, r]));
    const traceById = new Map(records.map(r => [r.trace_id, r]));
    const bindings = [];
    for (const record of records) {
      const sideRecord = annotationById.get(record.trace_id);
      if (!sideRecord) {
        diagnostics.push(diagnostic('missing_annotation', expectedSide, '該当するsidecarレコードがありません', record.trace_id));
        bindings.push({ trace_id:record.trace_id, status:'missing', annotation:null });
        continue;
      }
      let actualHash;
      try {
        actualHash = await computeRecordContentHash(record);
      } catch (error) {
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
    return {
      side:expectedSide, ready:diagnostics.length === 0, dataset_signature:signature,
      bindings, diagnostics, candidate_records:[], satisfaction_judgements:[]
    };
  }

  function blocked(side, diagnostics, signature) {
    return { side, ready:false, dataset_signature:signature || null, bindings:[], diagnostics, candidate_records:[], satisfaction_judgements:[] };
  }

  async function bindInputPair({ requirementTrace, requirementAnnotation, actualTrace, actualAnnotation }) {
    const requirement = await bindSide(requirementTrace, requirementAnnotation, 'requirement');
    const actual = await bindSide(actualTrace, actualAnnotation, 'actual');
    return {
      schema_version:'quantity-binding/phase-b1',
      ready:requirement.ready && actual.ready,
      requirement, actual,
      diagnostics:[...requirement.diagnostics, ...actual.diagnostics],
      comparison_candidates:[], satisfaction_judgements:[]
    };
  }

  function relationRefs(row) {
    return {
      requirement_trace_id:row?.requirement_trace_id || null,
      actual_trace_id:row?.actual_trace_id || null,
      matcher_a_id:row?.matcher_a_id || row?.A_ID || row?.['A_ID'] || null,
      matcher_b_id:row?.matcher_b_id || row?.B_ID || row?.['B_ID'] || null
    };
  }

  return Object.freeze({
    SCHEMA_VERSION, validateAnnotationSchema, canonicalValue, canonicalJson, normalize,
    hashParts, computeDatasetSignature, computeRecordContentHash, traceRecords,
    bindSide, bindInputPair, relationRefs
  });
});

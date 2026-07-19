'use strict';
const core = require('../quantity_sidecar_binding_core.js');
const { validate } = require('./json_schema_minivalidator.js');
const quantitySchema = require('./quantity_annotation_schema_v1.json');

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok:!!ok, detail }); }

function analysis(id = '0') {
  return {
    quantity_id:'q-' + id.repeat(32), source_field:'source_raw_text', occurrence_index:0,
    source_span:{ start:0, end:4 }, normalized_text:'12 kW',
    quantity:{ source_text:'12 kW', normalized_text:'12 kW',
      quantity:{ kind:'interval', lower:{ value:12, inclusive:true }, upper:null },
      unit:{ source:'kW', canonical:'kW', dimension:'power' },
      extraction:{ confidence:0.95, warnings:[] } },
    interval_semantics_candidates:[]
  };
}

function reqTrace(id = 'req-trace-1') {
  return { _trace_records:[{ trace_id:id, source_raw_text:'能力は12 kW以上', tags:['能力'], source_page:1 }] };
}

function actTrace(id = 'actual-trace-1') {
  return { _trace_records:[{ trace_id:id, source_record:{ 項目:'能力', 測定値:'12.5 kW' }, tags:['能力'], source_row:7 }] };
}

async function sidecar(trace, side) {
  const records = core.traceRecords(trace);
  return {
    schema_version:core.SCHEMA_VERSION, side, source_trace_file:`${side}.json`,
    hash_algorithm:'SHA-256', id_hash_algorithm:'SHA-256/128',
    dataset_signature:await core.computeDatasetSignature(records), generated_at:'2026-07-20T00:00:00Z',
    generator:{ tool:'verification', version:'1' },
    ruleset_version:{ quantity_extraction:'v2.14', semantics_rules:'v2.19', auto_applicable_thresholds:{ modeConfidence:0.4, margin:0.2, propertyConfidence:0.7 } },
    records:await Promise.all(records.map(async (record, i) => ({ trace_id:record.trace_id, content_hash:await core.computeRecordContentHash(record), analyses:[analysis(String(i % 10))] })))
  };
}

(async () => {
  const requirementTrace = reqTrace();
  const actualTrace = actTrace();
  const requirementAnnotation = await sidecar(requirementTrace, 'requirement');
  const actualAnnotation = await sidecar(actualTrace, 'actual');
  check('入力sidecarは正本quantity_annotation_schema_v1.jsonを満たす', validate(quantitySchema, requirementAnnotation).valid && validate(quantitySchema, actualAnnotation).valid);
  check('ブラウザ用Schema検証も同じ正しいsidecarを受理する', core.validateAnnotationSchema(requirementAnnotation).valid && core.validateAnnotationSchema(actualAnnotation).valid);

  const valid = await core.bindInputPair({ requirementTrace, requirementAnnotation, actualTrace, actualAnnotation });
  check('正しいtrace+sidecarは両側とも厳密結合できる', valid.ready, valid.diagnostics);
  check('結合層は候補を生成しない', valid.comparison_candidates.length === 0 && valid.requirement.candidate_records.length === 0 && valid.actual.candidate_records.length === 0);
  check('結合層は充足判定を生成しない', valid.satisfaction_judgements.length === 0 && valid.requirement.satisfaction_judgements.length === 0);

  const badSchema = structuredClone(requirementAnnotation);
  delete badSchema.hash_algorithm;
  check('同じSchema違反を正本Schemaとブラウザ用検証の双方が拒否する', !validate(quantitySchema, badSchema).valid && !core.validateAnnotationSchema(badSchema).valid);
  const schemaResult = await core.bindSide(requirementTrace, badSchema, 'requirement');
  check('Schema違反をschema_invalidとして停止する', !schemaResult.ready && schemaResult.diagnostics.some(d => d.code === 'schema_invalid'));
  check('Schema違反時に候補・充足判定を生成しない', schemaResult.candidate_records.length === 0 && schemaResult.satisfaction_judgements.length === 0);

  const mismatch = structuredClone(requirementAnnotation);
  mismatch.dataset_signature = 'QA-SHA256:' + 'f'.repeat(64);
  const mismatchResult = await core.bindSide(requirementTrace, mismatch, 'requirement');
  check('dataset_signature不一致をsource_mismatchとしてファイル全体停止する', !mismatchResult.ready && mismatchResult.bindings.length === 0 && mismatchResult.diagnostics.some(d => d.code === 'source_mismatch'));
  check('source_mismatch時に候補・充足判定を生成しない', mismatchResult.candidate_records.length === 0 && mismatchResult.satisfaction_judgements.length === 0);

  const stale = structuredClone(requirementAnnotation);
  stale.records[0].content_hash = 'e'.repeat(64);
  const staleResult = await core.bindSide(requirementTrace, stale, 'requirement');
  check('content_hash不一致をstale_annotationとしてレコード単位停止する', !staleResult.ready && staleResult.bindings[0].status === 'stale_annotation' && staleResult.diagnostics.some(d => d.code === 'stale_annotation'));
  check('stale_annotation時に候補・充足判定を生成しない', staleResult.candidate_records.length === 0 && staleResult.satisfaction_judgements.length === 0);

  const missing = structuredClone(requirementAnnotation);
  missing.records = [];
  const missingResult = await core.bindSide(requirementTrace, missing, 'requirement');
  check('sidecarレコード欠落をmissing_annotationとして明示する', !missingResult.ready && missingResult.bindings[0].status === 'missing' && missingResult.diagnostics.some(d => d.code === 'missing_annotation'));

  const duplicateTrace = reqTrace();
  duplicateTrace._trace_records.push(structuredClone(duplicateTrace._trace_records[0]));
  const duplicateTraceResult = await core.bindSide(duplicateTrace, requirementAnnotation, 'requirement');
  check('元traceの重複IDをduplicate_trace_idとして停止する', !duplicateTraceResult.ready && duplicateTraceResult.diagnostics.some(d => d.code === 'duplicate_trace_id'));

  const duplicateAnnotation = structuredClone(requirementAnnotation);
  duplicateAnnotation.records.push(structuredClone(duplicateAnnotation.records[0]));
  const duplicateAnnotationResult = await core.bindSide(requirementTrace, duplicateAnnotation, 'requirement');
  check('sidecarの重複IDをduplicate_annotation_idとして停止する', !duplicateAnnotationResult.ready && duplicateAnnotationResult.diagnostics.some(d => d.code === 'duplicate_annotation_id'));

  const pathTrace = actTrace('path-trace');
  pathTrace._trace_records[0].source_record_display_unresolved = [{ source_field:'仕様.能力', code:'formatted_display_unavailable', reason:'path_mapping_unsupported' }];
  const pathAnnotation = await sidecar(pathTrace, 'actual');
  const pathResult = await core.bindSide(pathTrace, pathAnnotation, 'actual');
  check('path_mapping_unsupportedをunparsedとして伝播する', !pathResult.ready && pathResult.bindings[0].status === 'unparsed' && pathResult.diagnostics.some(d => d.code === 'path_mapping_unsupported'));
  check('path_mapping_unsupported時に候補・充足判定を生成しない', pathResult.candidate_records.length === 0 && pathResult.satisfaction_judgements.length === 0);

  const refs = core.relationRefs({ requirement_trace_id:'req-trace-1', actual_trace_id:'actual-trace-1', matcher_a_id:'A-display-99', matcher_b_id:'7' });
  check('元trace_idとmatcher表示IDを別フィールドで保持する', refs.requirement_trace_id === 'req-trace-1' && refs.actual_trace_id === 'actual-trace-1' && refs.matcher_a_id === 'A-display-99' && refs.matcher_b_id === '7');

  console.log('\n=== quantity_sidecar_binding_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });

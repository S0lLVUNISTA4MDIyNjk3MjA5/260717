'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../quantity_sidecar_binding_core.js');
const { validate } = require('./json_schema_minivalidator.js');
const quantitySchema = require('./quantity_annotation_schema_v1.json');
const browserSchema = require('../generated/quantity_annotation_schema_v1.browser.js');
const schemaGenerator = require('./generate_quantity_annotation_browser_schema.js');

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok:!!ok, detail }); }

function readJson(file) { return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8')); }

function wrongType(value) {
  if (Array.isArray(value)) return {};
  if (value === null) return 'not-null';
  if (typeof value === 'string') return {};
  if (typeof value === 'number') return 'not-number';
  if (typeof value === 'boolean') return 'not-boolean';
  return 'not-object';
}

function resolveSchemaRef(schema, ref) {
  return ref.slice(2).split('/').reduce((node, key) => node[key], schema);
}

function mutateAt(document, pathParts, operation) {
  const clone = structuredClone(document);
  let parent = clone;
  for (const part of pathParts.slice(0, -1)) parent = parent[part];
  operation(parent, pathParts[pathParts.length - 1]);
  return clone;
}

function schemaDifferentialMutations(schema, document) {
  const mutations = [];
  function walk(node, value, pathParts, label) {
    if (node.$ref) return walk(resolveSchemaRef(schema, node.$ref), value, pathParts, label);
    if (node.oneOf) {
      const branch = node.oneOf.find(candidate => candidate.properties?.kind?.const === value?.kind) || node.oneOf[0];
      return walk(branch, value, pathParts, label);
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (node.additionalProperties === false) {
        mutations.push({ label:`${label}:余分なプロパティ`, doc:mutateAt(document, pathParts, (parent, key) => { parent[key].__injected = 'not allowed'; }) });
      }
      for (const key of (node.required || [])) {
        if (key in value) mutations.push({ label:`${label}.${key}:必須欠落`, doc:mutateAt(document, [...pathParts, key], (parent, leaf) => { delete parent[leaf]; }) });
      }
      for (const [key, child] of Object.entries(node.properties || {})) {
        if (!(key in value)) continue;
        const bad = mutateAt(document, [...pathParts, key], (parent, leaf) => { parent[leaf] = wrongType(parent[leaf]); });
        if (!validate(schema, bad).valid) mutations.push({ label:`${label}.${key}:型違反`, doc:bad });
        walk(child, value[key], [...pathParts, key], `${label}.${key}`);
      }
    } else if (Array.isArray(value) && node.items && value.length) {
      walk(node.items, value[0], [...pathParts, 0], `${label}[0]`);
    }
  }
  // Wrap the document so mutateAt can handle the root object uniformly.
  const wrapped = { root:document };
  function rootWalk(node, value) {
    // Reuse the walker with a synthetic root, then unwrap every mutation.
    const before = mutations.length;
    walk(node, value, ['root'], '$');
    for (let i = before; i < mutations.length; i++) mutations[i].doc = mutations[i].doc.root;
  }
  // Temporarily make mutateAt operate on the wrapper captured above.
  const saved = structuredClone(document);
  document = wrapped;
  rootWalk(schema, saved);
  document = saved;
  return mutations;
}

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
  check('ブラウザSchema生成物が正本JSON Schemaとdeep-equal', JSON.stringify(browserSchema) === JSON.stringify(quantitySchema));
  check('ブラウザSchema生成物がgeneratorの現在出力と一致', fs.readFileSync(schemaGenerator.outputPath, 'utf8') === schemaGenerator.render(quantitySchema));
  check('入力sidecarは正本quantity_annotation_schema_v1.jsonを満たす', validate(quantitySchema, requirementAnnotation).valid && validate(quantitySchema, actualAnnotation).valid);
  check('ブラウザ用Schema検証も同じ正しいsidecarを受理する', core.validateAnnotationSchema(requirementAnnotation, browserSchema).valid && core.validateAnnotationSchema(actualAnnotation, browserSchema).valid);

  const injectedSpan = structuredClone(requirementAnnotation);
  injectedSpan.records[0].analyses[0].source_span.injected = 'not allowed';
  check('source_spanの余分なプロパティを正本・ブラウザ双方が拒否する', !validate(quantitySchema, injectedSpan).valid && !core.validateAnnotationSchema(injectedSpan, browserSchema).valid);

  const valid = await core.bindInputPair({ requirementTrace, requirementAnnotation, actualTrace, actualAnnotation });
  check('正しいtrace+sidecarは両側とも厳密結合できる', valid.ready, valid.diagnostics);
  check('結合層は候補を生成しない', valid.comparison_candidates.length === 0 && valid.requirement.candidate_records.length === 0 && valid.actual.candidate_records.length === 0);
  check('結合層は充足判定を生成しない', valid.satisfaction_judgements.length === 0 && valid.requirement.satisfaction_judgements.length === 0);

  const badSchema = structuredClone(requirementAnnotation);
  delete badSchema.hash_algorithm;
  check('同じSchema違反を正本Schemaとブラウザ用検証の双方が拒否する', !validate(quantitySchema, badSchema).valid && !core.validateAnnotationSchema(badSchema, browserSchema).valid);
  const schemaResult = await core.bindSide(requirementTrace, badSchema, 'requirement');
  check('Schema違反をschema_invalidとして停止する', !schemaResult.ready && schemaResult.diagnostics.some(d => d.code === 'schema_invalid'));
  check('Schema違反時に候補・充足判定を生成しない', schemaResult.candidate_records.length === 0 && schemaResult.satisfaction_judgements.length === 0);

  const rulesetMutations = [
    ['quantity_extraction', doc => { doc.ruleset_version.quantity_extraction = 'v0.0'; }],
    ['semantics_rules', doc => { doc.ruleset_version.semantics_rules = 'v0.0'; }],
    ['modeConfidence', doc => { doc.ruleset_version.auto_applicable_thresholds.modeConfidence = 0; }],
    ['margin', doc => { doc.ruleset_version.auto_applicable_thresholds.margin = 0; }],
    ['propertyConfidence', doc => { doc.ruleset_version.auto_applicable_thresholds.propertyConfidence = 0; }]
  ];
  for (const [field, mutate] of rulesetMutations) {
    const changed = structuredClone(requirementAnnotation);
    mutate(changed);
    const result = await core.bindSide(requirementTrace, changed, 'requirement');
    check(`ruleset_version.${field}変更後もSchema自体は有効（互換性検証の責務を分離）`, validate(quantitySchema, changed).valid);
    check(`ruleset_version.${field}単独変更をruleset_mismatchで停止する`, !result.ready && result.bindings.length === 0 && result.diagnostics.some(d => d.code === 'ruleset_mismatch'));
    check(`ruleset_version.${field}不一致時は候補・充足判定0件`, result.candidate_records.length === 0 && result.satisfaction_judgements.length === 0);
  }

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
  check('sidecarレコード欠落は側全体を停止せず欠落レコードだけmissingにする', missingResult.ready && missingResult.bindings[0].status === 'missing');
  check('sidecarレコード欠落をnot_analyzed(reason:no_annotation)へ送る', missingResult.not_analyzed.length === 1 && missingResult.not_analyzed[0].trace_id === requirementTrace._trace_records[0].trace_id && missingResult.not_analyzed[0].reason_code === 'no_annotation');
  check('bindSide()単体でもnot_analyzedへsideを付与する(7bc4182レビュー、requirement)', missingResult.not_analyzed[0].side === 'requirement');
  check('missing_annotationはwarningとして明示する', missingResult.diagnostics.some(d => d.code === 'missing_annotation' && d.severity === 'warning'));
  const missingPair = await core.bindInputPair({ requirementTrace, requirementAnnotation:missing, actualTrace, actualAnnotation });
  check('pair結合でも欠落だけをnot_analyzedへ集約し正常側を継続する', missingPair.ready && missingPair.not_analyzed.length === 1 && missingPair.actual.bindings[0].status === 'bound');
  check('bindInputPair()の集約後もsideを保持する(7bc4182レビュー)', missingPair.not_analyzed[0].side === 'requirement');

  // ── 【7bc4182レビューの回帰テスト】要求側・実仕様側の双方が同じtrace_id("same")を持つ
  //    ケースで、結合層のnot_analyzedがside+trace_idの組で識別でき、配列の集約順序・要素順序に
  //    依存しないことを検証する。sideを付与する前は、trace_idだけでは両側のnot_analyzedを
  //    区別できず(bindInputPair()がrequirement.not_analyzedとactual.not_analyzedを単純結合するため)、
  //    同じtrace_idを持つ行が要求側由来か実仕様側由来か判別できない欠陥だった。
  const reqSame = reqTrace('same');
  const actSame = actTrace('same');
  const reqAnnotationSameFull = await sidecar(reqSame, 'requirement');
  const actAnnotationSameFull = await sidecar(actSame, 'actual');
  const reqAnnotationSameMissing = structuredClone(reqAnnotationSameFull); reqAnnotationSameMissing.records = [];
  const actAnnotationSameMissing = structuredClone(actAnnotationSameFull); actAnnotationSameMissing.records = [];

  const bothMissingPair = await core.bindInputPair({
    requirementTrace:reqSame, requirementAnnotation:reqAnnotationSameMissing,
    actualTrace:actSame, actualAnnotation:actAnnotationSameMissing,
  });
  check('双方のsidecarレコードが欠落しても、requirement:sameとactual:sameをsideで識別できる(7bc4182レビュー)',
    bothMissingPair.not_analyzed.length === 2
    && bothMissingPair.not_analyzed.some(n => n.side === 'requirement' && n.trace_id === 'same')
    && bothMissingPair.not_analyzed.some(n => n.side === 'actual' && n.trace_id === 'same'),
    bothMissingPair.not_analyzed);

  const keyOf = n => `${n.side}|${n.trace_id}`;
  const reversedMap = new Map([...bothMissingPair.not_analyzed].reverse().map(n => [keyOf(n), n]));
  check('配列を逆順にしても、side+trace_idをキーに同じ結果を取得できる(7bc4182レビュー)',
    reversedMap.size === 2
    && reversedMap.get('requirement|same')?.reason_code === 'no_annotation'
    && reversedMap.get('actual|same')?.reason_code === 'no_annotation',
    [...reversedMap.entries()]);

  const actualOnlyMissingPair = await core.bindInputPair({
    requirementTrace:reqSame, requirementAnnotation:reqAnnotationSameFull,
    actualTrace:actSame, actualAnnotation:actAnnotationSameMissing,
  });
  check('actual側だけ欠落した場合、side:"actual"として特定できる(7bc4182レビュー)',
    actualOnlyMissingPair.not_analyzed.length === 1
    && actualOnlyMissingPair.not_analyzed[0].side === 'actual'
    && actualOnlyMissingPair.not_analyzed[0].trace_id === 'same'
    && actualOnlyMissingPair.requirement.not_analyzed.length === 0,
    actualOnlyMissingPair.not_analyzed);

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

  const realFixtures = [
    ['PDF実生成fixture', 'runtime_fixtures/quantity_annotation_pdf_verified.json', 'requirement', 5],
    ['Excel work-JSON実生成fixture', 'runtime_fixtures/quantity_annotation_excel_verified.json', 'actual', 4],
    ['Excel実.xlsx生成fixture', 'runtime_fixtures/quantity_annotation_excel_xlsx_verified.json', 'actual', 3]
  ];
  for (const [label, file, sideName, expectedCount] of realFixtures) {
    const fixture = readJson(file);
    const result = await core.bindSide(fixture.sample_trace, fixture.sample_sidecar, sideName);
    check(`${label}を再合成せず直接厳密結合できる`, result.ready && result.bindings.filter(b => b.status === 'bound').length === expectedCount, result.diagnostics);
    check(`${label}の診断は0件`, result.diagnostics.length === 0, result.diagnostics);
  }

  const differentialDocs = [
    readJson('runtime_fixtures/quantity_annotation_pdf_verified.json').sample_sidecar,
    readJson('runtime_fixtures/quantity_annotation_excel_xlsx_verified.json').sample_sidecar
  ];
  const differential = differentialDocs.flatMap(doc => schemaDifferentialMutations(quantitySchema, doc));
  const disagreements = differential.filter(test => validate(quantitySchema, test.doc).valid !== core.validateAnnotationSchema(test.doc, browserSchema).valid);
  const unexpectedlyValid = differential.filter(test => validate(quantitySchema, test.doc).valid);
  check('全ネストobjectの余分プロパティ・必須欠落・型違反で正本とブラウザの合否が一致する', differential.length >= 80 && disagreements.length === 0, { count:differential.length, disagreements:disagreements.slice(0, 5).map(x => x.label) });
  check('差分テストで生成した全違反入力を正本Schemaが拒否する', unexpectedlyValid.length === 0, unexpectedlyValid.slice(0, 5).map(x => x.label));

  // ══════════════ own property修正の正本(json_schema_minivalidator.js)⇔移植コピー
  //     (quantity_sidecar_binding_core.js内validateAnnotationSchema())間のdrift検査 ══════════════
  // 【レビュー再指摘】正本側の`key in value`→hasOwnProperty()修正が、本ファイル内に別途移植
  // されているbrowser向けSchema検証コピー(validateSchemaNode()、quantity_sidecar_binding_core.js)
  // へ同期していなかった。プロトタイプ継承・additionalProperties予約名バイパスのいずれも
  // 移植コピー側に個別に再現し、両実装が同じ判定を返すことを確認する。
  {
    const baseDoc = differentialDocs[0];
    const inheritedOnly = Object.create(baseDoc);
    const primaryResult = validate(quantitySchema, inheritedOnly);
    const coreResult = core.validateAnnotationSchema(inheritedOnly, browserSchema);
    check('Object.create(正当な文書)は正本Schemaでvalid:falseになる(own property修正)',
      primaryResult.valid === false, primaryResult);
    check('Object.create(正当な文書)は移植コピー(validateAnnotationSchema)でもvalid:falseになる(drift検査)',
      coreResult.valid === false, coreResult);
  }
  for (const reservedKey of ['constructor', 'toString', 'hasOwnProperty']) {
    const mutated = structuredClone(differentialDocs[0]);
    Object.defineProperty(mutated.generator, reservedKey, { value: 'unexpected-field', enumerable: true, writable: true, configurable: true });
    const primaryResult = validate(quantitySchema, mutated);
    const coreResult = core.validateAnnotationSchema(mutated, browserSchema);
    check(`generator.${reservedKey}(予約名)は正本Schemaで余分なフィールドとして拒否される`,
      primaryResult.valid === false && primaryResult.errors.some(e => e.includes('未定義フィールド') && e.includes(reservedKey)), primaryResult);
    check(`generator.${reservedKey}(予約名)は移植コピーでも余分なフィールドとして拒否される(drift検査)`,
      coreResult.valid === false && coreResult.errors.some(e => e.includes('未定義フィールド') && e.includes(reservedKey)), coreResult);
  }

  console.log('\n=== quantity_sidecar_binding_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });

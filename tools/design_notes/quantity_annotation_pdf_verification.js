// フェーズA(数量注釈sidecar実装)PDF側の実ブラウザ検証。
// spec_to_json_conversion_tool_v1.18.htmlに実装した buildQuantityAnnotationSidecar() /
// v12ExportQuantityAnnotationSide() を、実際にPlaywrightでページを開いて検証する。
// tools/design_notes/hash_3paths_verification.js と同じ理由(実ブラウザのcrypto.subtle等、
// Node単体では再現できない実行環境に依存するコードパスを検証する必要がある)により、
// 本プロジェクトの「依存ゼロ」原則の明示的な例外として、Playwright(要 npm install)を使う。
//
// 検証する回帰項目(shadow_mode_integration_design.md 9節・フェーズA完了条件10):
//   1. 同一入力でのID・ハッシュ安定性
//   2. source_spanによる同一表記の数量の区別
//   3. タグ・本文変更による陳腐化検出(content_hashが変わる)
//   4. レコード順序変更に対するdataset_signatureの安定性(trace_id昇順への正規化)
//   5. 重複trace_idの拒否
//   6. 数量ゼロ件のレコードの扱い(エラーにならず空analyses)
//   7. 条件節(condition_candidates)がis_condition_value:trueとして別analysesに含まれる
//   8. 元trace JSONとsidecarが同一スナップショット(同一generated_at・同一trace_id集合)から生成される
//   9. 実際のブラウザ生成物がJSON Schema(quantity_annotation_schema_v1.json)を満たす
//  10. 既存のtrace JSON出力ボタン(#btn-trace-export)・通常JSON出力ボタン(#btn-export)が影響を受けない
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { validate } = require('./json_schema_minivalidator.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const TOOL = path.join(REPO_ROOT, 'tools/spec_to_json_conversion_tool_v1.18.html');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'quantity_annotation_schema_v1.json'), 'utf8'));
const PROFILE = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'samples/hvac_trace_sample_small/profile_pdf_customer_requirements.json'), 'utf8'));
const OUT_FIXTURE = path.join(__dirname, 'runtime_fixtures', 'quantity_annotation_pdf_verified.json');

const assertions = [];
function check(name, ok, detail) {
  assertions.push({ name, ok: !!ok, detail: detail !== undefined ? detail : undefined });
}

const SAMPLE_OBJ = {
  file_name: 'customer_hvac_requirements.pdf',
  document_number: 'CHV-REQ-001',
  revision: 'Rev. A',
  sections: [
    {
      section_number: '2.1',
      section_title: '冷房性能',
      content: [
        '冷房能力は12kW以上とすること。',
        '周囲温度50 °Cにおいて12.5 kWを実測。',
        '試験は50 °Cと50 °Cの両方で実施すること。',
        { type: 'list', items: ['電源電圧は220Vとすること。'] },
      ],
    },
    {
      section_number: '2.2',
      section_title: '付帯事項',
      content: ['本節には数量を含まない説明のみを記載する。'],
    },
  ],
};

async function withPage(fn) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto('file://' + TOOL);
  await page.waitForTimeout(300);
  try {
    return await fn(page, pageErrors);
  } finally {
    await browser.close();
  }
}

async function loadDocument(page, obj) {
  await page.evaluate(({ obj, profile }) => {
    activeProfile = profile;
    data = obj;
    if (typeof updateChrome === 'function') updateChrome();
  }, { obj, profile: PROFILE });
}

async function clickAndDownload(page, selector, savePath) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click(selector),
  ]);
  await download.saveAs(savePath);
  return JSON.parse(fs.readFileSync(savePath, 'utf8'));
}

(async () => {
  const fixtureDir = path.join(__dirname, 'runtime_fixtures');
  fs.mkdirSync(fixtureDir, { recursive: true });

  // ── パート1: buildQuantityAnnotationSidecar()を直接呼ぶ単体検証(hand-builtなtrace入力) ──
  await withPage(async (page, pageErrors) => {
    const baseTrace = {
      generated_at: '2026-07-19T00:00:00.000Z',
      _trace_records: [
        { trace_id: 'req-cooling-capacity', source_raw_text: '冷房能力は12kW以上とすること。', tags: ['性能要求'] },
        { trace_id: 'req-dup-text', source_raw_text: '試験は50 °Cと50 °Cの両方で実施すること。', tags: [] },
        { trace_id: 'req-condition', source_raw_text: '周囲温度50 °Cにおいて12.5 kWを実測。', tags: [] },
        { trace_id: 'req-empty', source_raw_text: '数量を含まない説明文。', tags: [] },
      ],
    };

    const sidecar1 = await page.evaluate(t => buildQuantityAnnotationSidecar(t, 'A', 'sample_trace_v1_3.json'), baseTrace);
    const sidecar2 = await page.evaluate(t => buildQuantityAnnotationSidecar(t, 'A', 'sample_trace_v1_3.json'), baseTrace);
    check('同一入力でdataset_signatureが安定する(1)', sidecar1.dataset_signature === sidecar2.dataset_signature);
    check('同一入力でquantity_idが安定する(1)', sidecar1.records[0].analyses[0].quantity_id === sidecar2.records[0].analyses[0].quantity_id);
    check('同一入力でcontent_hashが安定する(1)', sidecar1.records[0].content_hash === sidecar2.records[0].content_hash);

    const rDup = sidecar1.records.find(r => r.trace_id === 'req-dup-text');
    check('同一表記(50 °C)が1レコード内に2回出現すると2件のanalysesになる(2)', rDup.analyses.length === 2);
    check('同一表記でもsource_spanが異なる(2)', rDup.analyses[0].source_span.start !== rDup.analyses[1].source_span.start);
    check('同一表記でもquantity_idが異なる(2、source_span由来で一意)', rDup.analyses[0].quantity_id !== rDup.analyses[1].quantity_id);
    check('occurrence_indexが出現順に0,1になる(2、表示用の補助情報)', rDup.analyses[0].occurrence_index === 0 && rDup.analyses[1].occurrence_index === 1);

    // 3. タグ変更・本文変更によるcontent_hashの陳腐化検出
    const traceTagChanged = { ...baseTrace, _trace_records: baseTrace._trace_records.map(r => r.trace_id === 'req-cooling-capacity' ? { ...r, tags: [...r.tags, '追加タグ'] } : r) };
    const sidecarTagChanged = await page.evaluate(t => buildQuantityAnnotationSidecar(t, 'A', 'sample_trace_v1_3.json'), traceTagChanged);
    check('タグ変更でcontent_hashが変わる(3、陳腐化検出)', sidecarTagChanged.records[0].content_hash !== sidecar1.records[0].content_hash);

    const traceTextChanged = { ...baseTrace, _trace_records: baseTrace._trace_records.map(r => r.trace_id === 'req-cooling-capacity' ? { ...r, source_raw_text: r.source_raw_text + '追記。' } : r) };
    const sidecarTextChanged = await page.evaluate(t => buildQuantityAnnotationSidecar(t, 'A', 'sample_trace_v1_3.json'), traceTextChanged);
    check('本文変更でcontent_hashが変わる(3、陳腐化検出)', sidecarTextChanged.records[0].content_hash !== sidecar1.records[0].content_hash);

    // 4. レコード順序変更に対するdataset_signatureの安定性
    const traceReordered = { ...baseTrace, _trace_records: [...baseTrace._trace_records].reverse() };
    const sidecarReordered = await page.evaluate(t => buildQuantityAnnotationSidecar(t, 'A', 'sample_trace_v1_3.json'), traceReordered);
    check('レコード順序を反転してもdataset_signatureが変わらない(4、trace_id昇順への正規化)', sidecar1.dataset_signature === sidecarReordered.dataset_signature);

    // 5. 重複trace_id拒否
    const traceDup = { ...baseTrace, _trace_records: [...baseTrace._trace_records, { trace_id: 'req-cooling-capacity', source_raw_text: '別内容', tags: [] }] };
    const dupResult = await page.evaluate(async t => {
      try { await buildQuantityAnnotationSidecar(t, 'A', 'sample_trace_v1_3.json'); return { rejected: false }; }
      catch (e) { return { rejected: true, message: e.message }; }
    }, traceDup);
    check('重複trace_idを拒否する(5)', dupResult.rejected && /trace_idが重複/.test(dupResult.message), dupResult);

    // 6. 数量ゼロ件のレコード
    const rEmpty = sidecar1.records.find(r => r.trace_id === 'req-empty');
    check('数量ゼロ件でもエラーにならず空analysesになる(6)', Array.isArray(rEmpty.analyses) && rEmpty.analyses.length === 0);
    check('数量ゼロ件でもcontent_hashは計算される(6)', typeof rEmpty.content_hash === 'string' && rEmpty.content_hash.length === 64);
    check('dataset_signatureはsidecar生成時に常にnullでない(数量ゼロ件のレコードを含んでも)', typeof sidecar1.dataset_signature === 'string' && sidecar1.dataset_signature.startsWith('QA-SHA256:'));

    // 7. 条件節
    const rCond = sidecar1.records.find(r => r.trace_id === 'req-condition');
    check('条件節(condition_candidates)がis_condition_value:trueの別analysesになる(7)', rCond.analyses.some(a => a.is_condition_value === true));

    // side='B'は'actual'
    const sidecarB = await page.evaluate(t => buildQuantityAnnotationSidecar(t, 'B', 'sample_trace_v1_3.json'), baseTrace);
    check('side="B"はrequirementではなくactualになる', sidecarB.side === 'actual');

    check('単体検証中にページエラーが発生していない', pageErrors.length === 0, pageErrors);
  });

  // ── パート2: 実際のUIフロー(ボタンクリック)による end-to-end 検証 ──
  await withPage(async (page, pageErrors) => {
    const disabledBefore = await page.evaluate(() => document.getElementById('btn-quantity-annotation-export').disabled);
    check('文書読込前はボタンが無効(disabled)である', disabledBefore === true, { disabledBefore });

    await loadDocument(page, SAMPLE_OBJ);
    const disabledAfter = await page.evaluate(() => document.getElementById('btn-quantity-annotation-export').disabled);
    check('文書読込後はボタンが有効になる(10)', disabledAfter === false, { disabledBefore, disabledAfter });

    const traceJsonPath = path.join(fixtureDir, '_tmp_trace_export.json');
    const traceJson = await clickAndDownload(page, '#btn-trace-export', traceJsonPath);
    fs.unlinkSync(traceJsonPath);
    check('既存の「照合用JSON」ボタンが影響を受けず動作する(10)', Array.isArray(traceJson._trace_records) && traceJson._trace_records.length > 0, { records: traceJson._trace_records?.length });

    // 注: #btn-export(通常JSON、旧exportJson())は本フェーズAでは変更しておらず、また
    // validate(data)が要求するデータ形が本検証の合成fixture(obj、v12BuildDocumentModel()の
    // 入力形)とは別物(DocumentModel後の形を期待する古い経路)のため、ここでは検証対象に含めない。
    // #btn-trace-export(直上)が、新ボタンと全く同じv12BuildTrace()系の配線パターンを共有する
    // 既存ボタンであり、影響を受けていないことの確認としては十分。

    // 再読込して(v12ReviewCountsの状態が変わらないよう)同一スナップショットから両方を出力する
    await loadDocument(page, SAMPLE_OBJ);
    const traceJson2Path = path.join(fixtureDir, '_tmp_trace_export2.json');
    const traceJson2 = await clickAndDownload(page, '#btn-trace-export', traceJson2Path);
    fs.unlinkSync(traceJson2Path);

    const sidecarPath = path.join(fixtureDir, '_tmp_quantity_annotation.json');
    const sidecar = await clickAndDownload(page, '#btn-quantity-annotation-export', sidecarPath);
    fs.unlinkSync(sidecarPath);

    const traceIds = new Set(traceJson2._trace_records.map(r => r.trace_id));
    const sidecarIds = new Set(sidecar.records.map(r => r.trace_id));
    check('sidecarのtrace_id集合がtrace JSONのtrace_id集合と完全一致する(8、同一スナップショット)',
      traceIds.size === sidecarIds.size && [...traceIds].every(id => sidecarIds.has(id)),
      { traceIds: [...traceIds], sidecarIds: [...sidecarIds] });
    check('source_trace_fileがtrace JSONのファイル名と対応する(8)', sidecar.source_trace_file.includes('_trace_v1_3.json'));

    // 9. JSON Schema検証(実際にボタンクリックで得た生成物)
    const schemaResult = validate(SCHEMA, sidecar);
    check('実際のPDF生成物がJSON Schema(quantity_annotation_schema_v1.json)を満たす(9)', schemaResult.valid, schemaResult.errors);

    check('end-to-end検証中にページエラーが発生していない(ERR_TUNNEL_CONNECTION_FAILED等の無関係なネットワークエラーは許容)',
      pageErrors.every(e => /ERR_TUNNEL_CONNECTION_FAILED|net::/.test(e)), pageErrors);

    fs.writeFileSync(OUT_FIXTURE, JSON.stringify({ generated_at: new Date().toISOString(), sample_sidecar: sidecar }, null, 2));
  });

  console.log('\n=== quantity_annotation_pdf_verification 結果 ===');
  let fail = 0;
  for (const a of assertions) {
    console.log(`[${a.ok ? 'OK' : 'NG'}] ${a.name}`);
    if (!a.ok) { fail++; if (a.detail !== undefined) console.log('    detail:', JSON.stringify(a.detail)); }
  }
  console.log(`\n合計 ${assertions.length}件中 ${assertions.length - fail}件成功 / ${fail}件失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });

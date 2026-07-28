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
//   4. dataset_signatureが元trace(_trace_records)だけから導出され、analyses/意味候補/side
//      には依存しないこと。レコード順序変更に対する安定性(trace_id昇順への正規化)。
//   5. 重複trace_idの拒否
//   6. 数量ゼロ件のレコードの扱い(エラーにならず空analyses)
//   7. 条件節(condition_candidates)がis_condition_value:trueとして別analysesに含まれる
//   8. 元trace JSONとsidecarが、1回の操作・1回のv12BuildTrace()呼び出しから生成され、
//      generated_atが完全一致すること(同一スナップショットの構造的保証)
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

// exportJson()(#btn-export、通常JSON)のvalidateAgainst()はprofileのdoc_fields
// (chapter_number/chapter_title)が文字列であることを要求するため、両方を含める。
const SAMPLE_OBJ = {
  file_name: 'customer_hvac_requirements.pdf',
  chapter_number: '第2章',
  chapter_title: '要求仕様',
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

// #btn-quantity-annotation-export/-bは1クリックで2ファイル(照合用JSON→数量注釈JSON、
// この順にv12DownloadJson()を呼ぶ)をダウンロードする。両方を捕まえる。
async function clickAndDownloadBoth(page, selector, savePathTrace, savePathSidecar) {
  const downloads = [];
  const onDownload = d => downloads.push(d);
  page.on('download', onDownload);
  await page.click(selector);
  const deadline = Date.now() + 20000;
  while (downloads.length < 2 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 50));
  }
  page.off('download', onDownload);
  if (downloads.length < 2) throw new Error(`2件のダウンロードを期待したが${downloads.length}件しか観測されなかった`);
  // ダウンロード順を仮定せず、ファイル名(_trace_v1_3.json / _quantity_annotation_v1.json)で判別する。
  const traceDownload = downloads.find(d => d.suggestedFilename().includes('_trace_v1_3.json'));
  const sidecarDownload = downloads.find(d => d.suggestedFilename().includes('_quantity_annotation_v1.json'));
  if (!traceDownload || !sidecarDownload) throw new Error(`ダウンロードされたファイル名が想定外: ${downloads.map(d => d.suggestedFilename())}`);
  await traceDownload.saveAs(savePathTrace);
  await sidecarDownload.saveAs(savePathSidecar);
  return {
    trace: JSON.parse(fs.readFileSync(savePathTrace, 'utf8')),
    sidecar: JSON.parse(fs.readFileSync(savePathSidecar, 'utf8')),
  };
}

(async () => {
  const fixtureDir = path.join(__dirname, 'runtime_fixtures');
  fs.mkdirSync(fixtureDir, { recursive: true });

  // ── パート1: buildQuantityAnnotationSidecar()/v12ComputeDatasetSignature()を直接呼ぶ単体検証 ──
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

    // 4a. dataset_signatureは元trace(_trace_records)の非数量フィールド(タグ等)変更でも変わる
    check('タグ変更(元trace側)でdataset_signatureも変わる(4、元trace由来であることの確認)',
      sidecarTagChanged.dataset_signature !== sidecar1.dataset_signature);

    // 4b. dataset_signatureはanalyses/意味候補(side違いで内容が変わる)には依存しない
    const sidecarSideB = await page.evaluate(t => buildQuantityAnnotationSidecar(t, 'B', 'sample_trace_v1_3.json'), baseTrace);
    const analysesDiffer = JSON.stringify(sidecar1.records[0].analyses) !== JSON.stringify(sidecarSideB.records[0].analyses);
    check('side違いでanalyses/interval_semantics_candidatesの中身は実際に変わる(前提条件の確認)', analysesDiffer);
    check('side違い(analyses/意味候補が変わる)でもdataset_signatureは変わらない(4、sidecar派生値を含まないことの確認)',
      sidecar1.dataset_signature === sidecarSideB.dataset_signature);

    // 4c. レコード順序変更に対するdataset_signatureの安定性
    const traceReordered = { ...baseTrace, _trace_records: [...baseTrace._trace_records].reverse() };
    const sidecarReordered = await page.evaluate(t => buildQuantityAnnotationSidecar(t, 'A', 'sample_trace_v1_3.json'), traceReordered);
    check('レコード順序を反転してもdataset_signatureが変わらない(4、trace_id昇順への正規化)', sidecar1.dataset_signature === sidecarReordered.dataset_signature);

    // 4d. 元trace(_trace_records)だけから比較エンジン側が独立に再計算しても一致する
    const recomputed = await page.evaluate(t => v12ComputeDatasetSignature(t._trace_records), baseTrace);
    check('trace._trace_recordsから独立に再計算したdataset_signatureがsidecarの値と一致する(4、比較エンジン側の再計算契約)',
      recomputed === sidecar1.dataset_signature);

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

    check('side="B"はrequirementではなくactualになる', sidecarSideB.side === 'actual');
    check('id_hash_algorithmフィールドがSHA-256/128である', sidecar1.id_hash_algorithm === 'SHA-256/128');

    check('単体検証中にページエラーが発生していない', pageErrors.length === 0, pageErrors);
  });

  // ── パート2: 同一スナップショット保証の直接検証(v12BuildTraceの呼び出し回数を計測) ──
  await withPage(async (page, pageErrors) => {
    await loadDocument(page, SAMPLE_OBJ);

    // v12BuildTrace()を、呼び出しごとに異なるgenerated_atを返す(かつ呼び出し回数を記録する)
    // ものへ差し替える。もし#btn-quantity-annotation-exportの実装がv12BuildTrace()を2回
    // 呼んでいたら、trace側とsidecar側でgenerated_atが食い違い、下の一致検査が失敗する
    // (=このテストは「同一スナップショット」の退行を実際に検出できることの証明でもある)。
    const callCount = await page.evaluate(() => {
      window.__v12BuildTraceCallCount = 0;
      const orig = v12BuildTrace;
      v12BuildTrace = async (...args) => {
        window.__v12BuildTraceCallCount++;
        const t = await orig(...args);
        t.generated_at = new Date(Date.now() + window.__v12BuildTraceCallCount).toISOString();
        return t;
      };
      return true;
    });
    check('v12BuildTraceの差し替えに成功した(前提条件)', callCount === true);

    const traceP = path.join(fixtureDir, '_tmp_snapshot_trace.json');
    const sidecarP = path.join(fixtureDir, '_tmp_snapshot_sidecar.json');
    const { trace: traceOut, sidecar: sidecarOut } = await clickAndDownloadBoth(page, '#btn-quantity-annotation-export', traceP, sidecarP);
    fs.unlinkSync(traceP); fs.unlinkSync(sidecarP);

    const buildTraceCalls = await page.evaluate(() => window.__v12BuildTraceCallCount);
    check('新ボタン1クリックでv12BuildTrace()がちょうど1回だけ呼ばれる(8、同一スナップショットの直接検証)', buildTraceCalls === 1, { buildTraceCalls });
    check('trace JSONとsidecarのgenerated_atが完全一致する(8、v12BuildTrace()を2回呼んでいたらこの検査は失敗する)',
      traceOut.generated_at === sidecarOut.generated_at, { trace: traceOut.generated_at, sidecar: sidecarOut.generated_at });
    check('sidecarのtrace_id集合がtrace JSONのtrace_id集合と完全一致する(8)',
      JSON.stringify([...traceOut._trace_records.map(r=>r.trace_id)].sort()) === JSON.stringify([...sidecarOut.records.map(r=>r.trace_id)].sort()));
    check('source_trace_fileがtrace JSONのファイル名と対応する(8)', sidecarOut.source_trace_file.includes('_trace_v1_3.json'));

    check('パート2実行中にページエラーが発生していない', pageErrors.length === 0, pageErrors);

    fs.writeFileSync(OUT_FIXTURE, JSON.stringify({ generated_at: new Date().toISOString(), sample_trace: traceOut, sample_sidecar: sidecarOut }, null, 2));
  });

  // ── パート3: 実際のUIフロー(ボタンクリック)による end-to-end 検証、既存ボタンの非退行確認 ──
  await withPage(async (page, pageErrors) => {
    const disabledBefore = await page.evaluate(() => document.getElementById('btn-quantity-annotation-export').disabled);
    check('文書読込前はボタンが無効(disabled)である', disabledBefore === true, { disabledBefore });

    await loadDocument(page, SAMPLE_OBJ);
    const disabledAfter = await page.evaluate(() => document.getElementById('btn-quantity-annotation-export').disabled);
    check('文書読込後はボタンが有効になる(10)', disabledAfter === false, { disabledBefore, disabledAfter });

    // 既存の「照合用JSON」ボタン(#btn-trace-export)
    const traceJsonPath = path.join(fixtureDir, '_tmp_trace_export.json');
    const traceJson = await clickAndDownload(page, '#btn-trace-export', traceJsonPath);
    fs.unlinkSync(traceJsonPath);
    check('既存の「照合用JSON」ボタンが影響を受けず動作する(10)', Array.isArray(traceJson._trace_records) && traceJson._trace_records.length > 0, { records: traceJson._trace_records?.length });

    // 既存の「通常JSON」ボタン(#btn-export)。以前はSAMPLE_OBJにchapter_number/chapter_titleが
    // 無くvalidateAgainst()が失敗しダウンロードされなかった(検証漏れ)。fixture側を修正し、
    // 実際にE2Eでダウンロードを確認する。初期化時のrebuildActions()がこのボタンを
    // 折りたたみ済みの<details class="ui14-inline-menu">(「文書・その他」)へ移動するため、
    // 先にdetailsを開いてからクリックする(既存UIの挙動そのものであり、変更はしていない)。
    await loadDocument(page, SAMPLE_OBJ);
    await page.evaluate(() => { document.querySelector('#btn-export').closest('details').open = true; });
    const normalJsonPath = path.join(fixtureDir, '_tmp_normal_export.json');
    const normalJson = await clickAndDownload(page, '#btn-export', normalJsonPath);
    fs.unlinkSync(normalJsonPath);
    check('既存の「通常JSON」ボタンが影響を受けず動作する(10)',
      normalJson.chapter_number === SAMPLE_OBJ.chapter_number && Array.isArray(normalJson.sections) && normalJson.sections.length === SAMPLE_OBJ.sections.length,
      { chapter_number: normalJson.chapter_number, sections: normalJson.sections?.length });

    // 新ボタン(1クリック2ダウンロード)のend-to-end検証
    await loadDocument(page, SAMPLE_OBJ);
    const traceP2 = path.join(fixtureDir, '_tmp_e2e_trace.json');
    const sidecarP2 = path.join(fixtureDir, '_tmp_e2e_sidecar.json');
    const { trace, sidecar } = await clickAndDownloadBoth(page, '#btn-quantity-annotation-export', traceP2, sidecarP2);
    fs.unlinkSync(traceP2); fs.unlinkSync(sidecarP2);

    check('新ボタンのend-to-end出力でもgenerated_atが一致する(8)', trace.generated_at === sidecar.generated_at);

    // Schema外の不変条件検査(JSON Schemaでは表現できない、値同士の関係に関する検査)。
    // 実際のブラウザ生成物(実データ)に対して検証する。
    const traceById = new Map(trace._trace_records.map(r => [r.trace_id, r]));
    let spanOrderOk = true, spanOrderDetail = null;
    let sourceTextAlignedOk = true, sourceTextAlignedDetail = null;
    for (const rec of sidecar.records) {
      const traceRec = traceById.get(rec.trace_id);
      for (const a of rec.analyses) {
        if (!(a.source_span.end >= a.source_span.start)) {
          spanOrderOk = false;
          spanOrderDetail = { trace_id: rec.trace_id, source_span: a.source_span };
        }
        // is_condition_valueの場合、quantity.source_text=condition_candidatesの原文(=元quantityと
        // 同じsource_raw_text内)であり、通常の数量と同じ規則でsource_raw_textから復元できる。
        const expected = traceRec.source_raw_text.slice(a.source_span.start, a.source_span.end);
        if (expected !== a.quantity.source_text) {
          sourceTextAlignedOk = false;
          sourceTextAlignedDetail = { trace_id: rec.trace_id, expected, actual: a.quantity.source_text, source_span: a.source_span };
        }
      }
    }
    check('全analysesでsource_span.end >= source_span.start(Schema外の不変条件、実データで検証)', spanOrderOk, spanOrderDetail);
    check('全analysesでsource_textが元trace(source_raw_text)のsource_span位置と一致する(Schema外の不変条件、実データで検証)', sourceTextAlignedOk, sourceTextAlignedDetail);

    // 9. JSON Schema検証(実際にボタンクリックで得た生成物)
    const schemaResult = validate(SCHEMA, sidecar);
    check('実際のPDF生成物がJSON Schema(quantity_annotation_schema_v1.json)を満たす(9)', schemaResult.valid, schemaResult.errors);

    check('end-to-end検証中にページエラーが発生していない(ERR_TUNNEL_CONNECTION_FAILED等の無関係なネットワークエラーは許容)',
      pageErrors.every(e => /ERR_TUNNEL_CONNECTION_FAILED|net::/.test(e)), pageErrors);
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

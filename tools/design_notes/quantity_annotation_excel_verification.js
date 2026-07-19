// フェーズA(数量注釈sidecar実装)Excel側の実ブラウザ検証。
// excel_to_json_conversion_tool_v2.0.8.htmlに実装した buildQuantityAnnotationSidecarExcel() /
// exportQuantityAnnotationExcel() を、実際にPlaywrightでページを開いて検証する。
// tools/design_notes/hash_3paths_verification.js / quantity_annotation_pdf_verification.js と
// 同じ理由により、本プロジェクトの「依存ゼロ」原則の明示的な例外としてPlaywright(要npm install)を使う。
//
// 【本ツール固有の制約】excel_to_json_conversion_tool_v2.0.8.htmlは全体が単一のIIFEで
// 包まれており(PDF側のような複数の平坦な<script>ブロックと異なる)、内部関数はwindowへ
// 一切公開されていない。そのためPDF側検証で使ったpage.evaluate()による内部関数の直接呼び出しや
// モンキーパッチは行えず、本検証は実際のUI操作(ファイル入力・ボタンクリック・ダウンロード捕捉)
// のみで行う。また、実際の.xlsx読込にはCDN(cdn.jsdelivr.net)からのxlsxライブラリ取得が必要だが、
// このサンドボックス環境ではCDNアクセスがネットワークポリシーで拒否されているため.xlsx経由の
// 検証はできない(実測: cdn.jsdelivr.net/unpkg.com/cdnjs.cloudflare.comいずれも接続不可)。
// 代わりに、ツール自身の「作業中JSON読込」(work_format: excel-json-work-v2、#workJsonInput)を使う。
// これはXLSX解析後の状態をJSONとして保存・復元する、ツール自身の既存機能であり、
// restoreWorkspaceObject()がcurrentData/activeProfile等を直接設定する(XLSX非依存の正規の経路)。
//
// 検証する回帰項目(shadow_mode_integration_design.md 9節・フェーズA完了条件10):
//   1. 同一入力でのID・ハッシュ安定性
//   2. source_spanによる同一表記の数量の区別(同一セル内)
//   3. タグ・セル内容変更による陳腐化検出(content_hashが変わる)
//   4. dataset_signatureが元trace(_trace_records)だけから導出され、analysesには依存しないこと。
//      レコード順序に対する安定性、重複trace_idの拒否。
//   5. 数量ゼロ件のレコードの扱い(エラーにならず空analyses)
//   6. 明らかな管理列(No、tags、review_status等)が自動走査から除外される
//   7. 列役割候補(baseline_design/resolved_design)がキーワード・位置・値分布の根拠から生成される
//   8. 条件節(condition_candidates)がis_condition_value:trueとして別analysesに含まれる
//   9. 元trace JSONとsidecarが同一スナップショット(同一generated_at)から生成される
//  10. 実際のブラウザ生成物がJSON Schema(quantity_annotation_schema_v1.json)を満たす
//  11. 既存のbuildTraceBtn・downloadJsonBtnの組み合わせが影響を受けない
//
// 【未実装・既知の範囲外】列役割の手動override(shadow_mode_integration_design.md 2.3節4番、
// 「自動候補の確信度が低い場合に利用者が明示指定する任意設定」)は、設計文書自体が
// 「必須ではない」と明記している任意機能であり、本フェーズでは実装していない
// (自動候補生成のみ。「候補は生成してよいが確定はしない」の原則どおり、候補提示に留める)。
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { validate } = require('./json_schema_minivalidator.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const TOOL = path.join(REPO_ROOT, 'tools/excel_to_json_conversion_tool_v2.0.8.html');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'quantity_annotation_schema_v1.json'), 'utf8'));
const OUT_FIXTURE = path.join(__dirname, 'runtime_fixtures', 'quantity_annotation_excel_verified.json');

const assertions = [];
function check(name, ok, detail) { assertions.push({ name, ok: !!ok, detail: detail !== undefined ? detail : undefined }); }

function workPackage(records, overrides) {
  return Object.assign({
    work_format: 'excel-json-work-v2',
    schema_version: '2.0',
    saved_at: '2026-07-19T00:00:00.000Z',
    source: { file_name: 'customer_hvac_design_review.xlsx', sheet_name: '設計検討表' },
    document_meta: {},
    active_profile: {
      profile_name: 'テスト様式', profile_version: '1.0',
      output: { mode: 'array', preserve_unmapped: true, tags_field: 'tags', unregistered_tags_field: 'unregistered_tags', review_status_field: 'review_status' },
      tag_policy: { mode: 'controlled', vocabulary_id: 'test', tag_vocabulary_version: '1.0', allow_free_input: false, allowed_tags: [] },
    },
    current_records: records,
    cell_meta: records.map(() => ({})),
    output_data: [],
    output_cell_meta: records.map(() => ({})),
    profile_record_key: null,
    output_mode_all_sheets: false,
  }, overrides || {});
}

const BASE_RECORDS = [
  { '設計項目': '冷房能力', '標準機種情報': '10 kW', '検討結果': '12.5 kWに変更', 'No': 1 },
  { '設計項目': '付帯事項', '標準機種情報': '', '検討結果': '変更なし', 'No': 2 },
  { '設計項目': '実測条件', '標準機種情報': '周囲温度50 °Cにおいて12.5 kWを実測', '検討結果': '', 'No': 3 },
  { '設計項目': '試験', '標準機種情報': '50 °Cと50 °Cの両方で実施', '検討結果': '', 'No': 4 },
];

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

async function loadWorkJson(page, obj, tmpDir) {
  const p = path.join(tmpDir, `_tmp_work_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, JSON.stringify(obj));
  await page.setInputFiles('#workJsonInput', p);
  await page.waitForTimeout(300);
  fs.unlinkSync(p);
  await page.click('[data-tab="profileTab"]');
  await page.waitForTimeout(100);
}

async function clickQuantityAnnotationButton(page, tmpDir) {
  const downloads = [];
  const onDownload = d => downloads.push(d);
  page.on('download', onDownload);
  await page.click('#buildQuantityAnnotationBtn');
  const deadline = Date.now() + 20000;
  while (downloads.length < 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  page.off('download', onDownload);
  if (downloads.length < 2) throw new Error(`2件のダウンロードを期待したが${downloads.length}件しか観測されなかった`);
  const traceDl = downloads.find(d => d.suggestedFilename().includes('_trace_v1.json'));
  const sidecarDl = downloads.find(d => d.suggestedFilename().includes('_quantity_annotation_v1.json'));
  if (!traceDl || !sidecarDl) throw new Error(`ダウンロードされたファイル名が想定外: ${downloads.map(d => d.suggestedFilename())}`);
  const tp = path.join(tmpDir, `_tmp_trace_${Date.now()}.json`);
  const sp = path.join(tmpDir, `_tmp_sidecar_${Date.now()}.json`);
  await traceDl.saveAs(tp);
  await sidecarDl.saveAs(sp);
  const trace = JSON.parse(fs.readFileSync(tp, 'utf8'));
  const sidecar = JSON.parse(fs.readFileSync(sp, 'utf8'));
  fs.unlinkSync(tp); fs.unlinkSync(sp);
  return { trace, sidecar };
}

(async () => {
  const fixtureDir = path.join(__dirname, 'runtime_fixtures');
  fs.mkdirSync(fixtureDir, { recursive: true });

  await withPage(async (page, pageErrors) => {
    // ── 1. 同一入力での安定性 ──
    await loadWorkJson(page, workPackage(BASE_RECORDS), fixtureDir);
    const run1 = await clickQuantityAnnotationButton(page, fixtureDir);
    await loadWorkJson(page, workPackage(BASE_RECORDS), fixtureDir);
    const run2 = await clickQuantityAnnotationButton(page, fixtureDir);
    check('同一入力でdataset_signatureが安定する(1)', run1.sidecar.dataset_signature === run2.sidecar.dataset_signature);
    const r1row0 = run1.sidecar.records.find(r => r.trace_id === run1.trace._trace_records[0].trace_id);
    const r2row0 = run2.sidecar.records.find(r => r.trace_id === run2.trace._trace_records[0].trace_id);
    check('同一入力でcontent_hashが安定する(1)', r1row0.content_hash === r2row0.content_hash);
    check('同一入力でquantity_idが安定する(1)', r1row0.analyses[0]?.quantity_id === r2row0.analyses[0]?.quantity_id);

    // ── 2. 同一セル内の重複表記の区別 ──
    const dupRow = run1.sidecar.records.find(r => r.analyses.length === 2 && r.analyses[0].normalized_text === r.analyses[1].normalized_text);
    check('同一セル内の同一表記(50 °C)が2件のanalysesに分かれる(2)', !!dupRow, { records: run1.sidecar.records.map(r => r.analyses.map(a => a.normalized_text)) });
    if (dupRow) {
      check('同一表記でもsource_spanが異なる(2)', dupRow.analyses[0].source_span.start !== dupRow.analyses[1].source_span.start);
      check('同一表記でもquantity_idが異なる(2)', dupRow.analyses[0].quantity_id !== dupRow.analyses[1].quantity_id);
    }

    // ── 3. タグ・セル内容変更による陳腐化検出 ──
    const taggedRecords = BASE_RECORDS.map((r, i) => i === 0 ? { ...r, tags: ['性能'] } : r);
    await loadWorkJson(page, workPackage(taggedRecords, { active_profile: { ...workPackage(BASE_RECORDS).active_profile, tag_policy: { mode: 'controlled', vocabulary_id: 'test', tag_vocabulary_version: '1.0', allow_free_input: false, allowed_tags: ['性能'] } } }), fixtureDir);
    const runTagged = await clickQuantityAnnotationButton(page, fixtureDir);
    const taggedRow0 = runTagged.sidecar.records.find(r => r.trace_id === runTagged.trace._trace_records[0].trace_id);
    check('タグ変更でcontent_hashが変わる(3、陳腐化検出)', taggedRow0.content_hash !== r1row0.content_hash);

    const textChangedRecords = BASE_RECORDS.map((r, i) => i === 0 ? { ...r, '標準機種情報': '11 kW' } : r);
    await loadWorkJson(page, workPackage(textChangedRecords), fixtureDir);
    const runTextChanged = await clickQuantityAnnotationButton(page, fixtureDir);
    const textChangedRow0 = runTextChanged.sidecar.records.find(r => r.trace_id === runTextChanged.trace._trace_records[0].trace_id);
    check('セル内容変更でcontent_hashが変わる(3、陳腐化検出)', textChangedRow0.content_hash !== r1row0.content_hash);

    // 他列(検討結果)の変更でも、対象行のcontent_hashが変わる(行全体が対象範囲であることの確認)
    const otherColChanged = BASE_RECORDS.map((r, i) => i === 0 ? { ...r, '検討結果': '別の値に変更' } : r);
    await loadWorkJson(page, workPackage(otherColChanged), fixtureDir);
    const runOtherColChanged = await clickQuantityAnnotationButton(page, fixtureDir);
    const otherColChangedRow0 = runOtherColChanged.sidecar.records.find(r => r.trace_id === runOtherColChanged.trace._trace_records[0].trace_id);
    check('対象セル以外の同一行内の列変更でもcontent_hashが変わる(3、行全体が対象範囲)', otherColChangedRow0.content_hash !== r1row0.content_hash);

    // ── 4. dataset_signature ──
    await loadWorkJson(page, workPackage(BASE_RECORDS), fixtureDir);
    const runA = await clickQuantityAnnotationButton(page, fixtureDir);

    // 【重要な注記】Excel側のtrace_recordには`source_path: "$._trace_records[${index}]"`
    // (buildTraceOutput()、配列位置そのものを指す既存フィールド)が含まれる。この値は
    // 入力行の配列順序が変わると必然的に変化するため、入力行を単純に逆順にすると
    // (中身が同一でも)各レコードのsource_pathが変わり、結果としてdataset_signatureも変わる。
    // これは実際に検証して確認した(実データで再現)。PDF側にはこの種の位置エンコードフィールドが
    // ないため真の順序不変性を確認できたが、Excel側で同じ検証をしようとすると
    // 「配列を逆順にする」操作自体がレコードの実内容(source_path)を変えてしまい、
    // 意味のある検証にならない。位置由来のsource_pathを内容の一部として扱い、
    // 配置が変われば陳腐化検出するのは安全側の設計として妥当(異なる配置を同一データと
    // 誤認しない)と判断し、production側はこの挙動のまま維持した。
    // 代わりに、より直接的で意味のある契約(trace_id昇順への正規化)を、Node側で独立に
    // 再計算した値と実際のsidecarの値を突き合わせる形で検証する(下記)。

    // ── dataset_signatureの「trace_id昇順に正規化してハッシュする」契約を、比較エンジン側の
    //    独立再計算という形で検証する(Node側でv12ComputeDatasetSignature相当を再実装し、
    //    ダウンロードされたtrace._trace_recordsだけから同じ値を再現できることを確認する)。
    const crypto = require('crypto');
    function nodeV12Normalize(value) {
      return String(value ?? '').normalize('NFKC').replace(/\r\n?/g, '\n').split('\n').map(s => s.replace(/[ \t]+$/g, '')).join('\n').replace(/[ \t]+/g, ' ').trim();
    }
    function nodeV12HashParts(namespace, parts) {
      const NUL = String.fromCharCode(0);
      return crypto.createHash('sha256').update(Buffer.from([namespace, ...parts.map(nodeV12Normalize)].join(NUL), 'utf8')).digest('hex');
    }
    function nodeCanonicalValue(value) {
      if (Array.isArray(value)) return value.map(nodeCanonicalValue);
      if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).sort().forEach(key => { out[key] = nodeCanonicalValue(value[key]); });
        return out;
      }
      return value;
    }
    function nodeComputeDatasetSignature(traceRecords) {
      const sorted = [...traceRecords].sort((a, b) => a.trace_id < b.trace_id ? -1 : a.trace_id > b.trace_id ? 1 : 0);
      return 'QA-SHA256:' + nodeV12HashParts('dataset-signature-v1', [JSON.stringify(nodeCanonicalValue(sorted))]);
    }
    const recomputed = nodeComputeDatasetSignature(runA.trace._trace_records);
    check('trace._trace_recordsから比較エンジン側が独立に再計算したdataset_signatureが、実際のsidecarの値と一致する(4、trace_id昇順への正規化契約の直接検証)',
      recomputed === runA.sidecar.dataset_signature, { recomputed, actual: runA.sidecar.dataset_signature });

    // 重複trace_id(明示指定)は生成エラーとして扱われ、ダウンロードが発生しないことを確認する。
    const dupIdRecords = BASE_RECORDS.map(r => ({ ...r, trace_id: 'dup-id' }));
    await loadWorkJson(page, workPackage(dupIdRecords), fixtureDir);
    await page.click('#buildQuantityAnnotationBtn');
    await page.waitForTimeout(1500);
    const dupMessage = await page.evaluate(() => document.getElementById('profileMessage').textContent);
    check('重複trace_id(明示指定)でエラーになる(4)', /trace_idが重複|エラー/.test(dupMessage || ''), dupMessage);

    // ── 5. 数量ゼロ件のレコード ──
    const rEmpty = runA.sidecar.records.find(r => r.analyses.length === 0);
    check('数量ゼロ件のレコードが存在しエラーにならない(5)', !!rEmpty);
    if (rEmpty) check('数量ゼロ件でもcontent_hashは計算される(5)', typeof rEmpty.content_hash === 'string' && rEmpty.content_hash.length === 64);

    // ── 6. 管理列の自動除外 ──
    const anyRecordAnalyses = runA.sidecar.records.flatMap(r => r.analyses.map(a => a.source_field));
    check('管理列(No)がanalysesの対象から除外される(6)', !anyRecordAnalyses.includes('No'));
    check('管理列(tags/review_status等)がcolumn_role_candidatesに含まれない(6)',
      !runA.sidecar.column_role_candidates.some(c => ['No', 'tags', 'unregistered_tags', 'review_status'].includes(c.column)));

    // ── 7. 列役割候補 ──
    const baselineCol = runA.sidecar.column_role_candidates.find(c => c.column === '標準機種情報');
    const resolvedCol = runA.sidecar.column_role_candidates.find(c => c.column === '検討結果');
    check('「標準機種情報」列がbaseline_design候補を持つ(7、キーワード根拠)', baselineCol.role_candidates.some(c => c.role === 'baseline_design'));
    check('「検討結果」列がresolved_design候補を持つ(7、キーワード根拠)', resolvedCol.role_candidates.some(c => c.role === 'resolved_design'));
    check('「検討結果」列の候補に位置的根拠(position_near_baseline)が含まれる(7)',
      resolvedCol.role_candidates.some(c => c.evidence.some(e => e.type === 'position_near_baseline')));

    // shadow_mode_integration_design.md 6節20番: 「標準機種情報」「検討結果」以外の同義見出し
    // (「標準仕様」「客先対応値」)でも役割候補が生成されることを確認する(キーワード部分一致が
    // ハードコードされた完全一致の代替になっていることの直接検証)。
    const synonymRecords = [
      { '項目': '耐圧性能', '標準仕様': '0.5 MPa', '客先対応値': '0.6 MPaに変更' },
      { '項目': '付帯事項', '標準仕様': '', '客先対応値': '変更なし' },
    ];
    await loadWorkJson(page, workPackage(synonymRecords), fixtureDir);
    const runSynonym = await clickQuantityAnnotationButton(page, fixtureDir);
    const synBaseline = runSynonym.sidecar.column_role_candidates.find(c => c.column === '標準仕様');
    const synResolved = runSynonym.sidecar.column_role_candidates.find(c => c.column === '客先対応値');
    check('「標準仕様」列(同義見出し)がbaseline_design候補を持つ(7、6節20番)', synBaseline?.role_candidates.some(c => c.role === 'baseline_design'), synBaseline);
    check('「客先対応値」列(同義見出し)がresolved_design候補を持つ(7、6節20番)', synResolved?.role_candidates.some(c => c.role === 'resolved_design'), synResolved);

    // shadow_mode_integration_design.md 6節21番: 根拠が乏しい列は、role:"unknown"のまま
    // 高確信度のbaseline/resolved候補に自動確定しないことを確認する(構造的根拠だけで
    // 役割を確定しない、という非対称設計の原則。「項目」列はキーワード・位置・分布の
    // いずれの根拠も弱いか存在しないはず)。
    const synItemCol = runSynonym.sidecar.column_role_candidates.find(c => c.column === '項目');
    check('根拠の乏しい列は高確信度で自動確定しない(7、6節21番)',
      !synItemCol || synItemCol.role_candidates.every(c => c.confidence < 0.5), synItemCol);

    // ── 7b. 意味候補への列見出し・他セルの漏れ込み防止(859349fへのレビューで発見された
    //    高重大度の不具合の回帰テスト) ──
    // 当初buildNearbyText()が対象セル以外(同一行の他列・対象列の列見出し自体)まで
    // interval_semantics候補生成のキーワード照合対象に含めており、"検討結果"という列見出しが
    // ACHIEVED_POINT_KEYWORD_PATTERNの"検討(?:の)?結果"に一致してしまい、セル値の内容に
    // 関わらず強いキーワード根拠(weight 0.4)が加点されていた。修正後は対象セル自身の値のみを
    // 意味候補生成へ渡し、列名はctx.sourceColumn経由の弱い根拠(weight 0.05)としてのみ働く。
    const leakTestRecords = [
      { '設計項目': '達成値混在テスト', '標準仕様': '10 kW', '検討結果': '12.5 kWに変更' },
      { '設計項目': '実測語テスト', '標準仕様': '12.5 kWを実測', '検討結果': '' },
      { '設計項目': '無関係語テスト', '標準仕様': '公称20 kW', '参考値列': '参考値25 kW、試験は非該当' },
    ];
    await loadWorkJson(page, workPackage(leakTestRecords), fixtureDir);
    const runLeak = await clickQuantityAnnotationButton(page, fixtureDir);
    const leakRows = runLeak.sidecar.records;
    const findAnalysis = (rowIdx, field) => leakRows[rowIdx].analyses.find(a => a.source_field === field);

    // 1. 検討結果="12.5 kWに変更"ではキーワード0.4が付かず、最大でも形状0.3+列役割0.05=0.35になる
    const kentouKakou = findAnalysis(0, '検討結果');
    const achievedKentou = kentouKakou.interval_semantics_candidates.find(c => c.value === 'achieved_point');
    check('検討結果="12.5 kWに変更"はachieved_pointが0.4未満(最大0.35、キーワード漏れ防止)(回帰1)',
      achievedKentou && achievedKentou.confidence <= 0.35 + 1e-9, achievedKentou);
    check('検討結果="12.5 kWに変更"のevidenceにkeyword由来の根拠が含まれない(回帰1)',
      !achievedKentou.evidence.some(e => e.type === 'keyword'), achievedKentou.evidence);

    // 2. 検討結果="12.5 kWを実測"(2行目、標準仕様列)ではキーワード0.4が付く(セル自身の文言なので正当)
    const jissokuHyoujun = findAnalysis(1, '標準仕様');
    const achievedJissoku = jissokuHyoujun.interval_semantics_candidates.find(c => c.value === 'achieved_point');
    check('セル自身に"実測"を含む場合はキーワード根拠(weight 0.4)が付く(回帰2)',
      achievedJissoku && achievedJissoku.evidence.some(e => e.type === 'keyword' && e.weight === 0.4), achievedJissoku);

    // 3. 標準仕様="10 kW"(1行目)には、同じ行の検討結果セルの文言が伝播しない
    const hyoujunSpec = findAnalysis(0, '標準仕様');
    const achievedHyoujun = hyoujunSpec.interval_semantics_candidates.find(c => c.value === 'achieved_point');
    check('標準仕様="10 kW"には検討結果列からのキーワード根拠が伝播しない(回帰3)',
      achievedHyoujun && achievedHyoujun.confidence < 0.4, achievedHyoujun);

    // 4. 対象外セルの「公称」「参考値」「試験」が、同じセル内の対象数量以外へ伝播しない
    //    (3行目: 標準仕様="公称20 kW"、参考値列="参考値25 kW、試験は非該当"。列をまたいだ伝播が
    //    無いことを検証する。同一セル内の"公称"はそのセル自身の候補への正当な根拠になり得るため、
    //    ここでは"他列からの伝播が無いこと"だけを検証する)
    // 汎用の不変条件: あるセルのinterval_semantics_candidatesが持つevidenceのsource_textは、
    // 常にそのセル自身の値の範囲内に収まっていなければならない(他セルの文言が混入していないこと)。
    const koushouCol = findAnalysis(2, '標準仕様');
    const sankoCol = findAnalysis(2, '参考値列');
    const evidenceStaysWithinOwnCell = (analysis, ownCellText) =>
      analysis.interval_semantics_candidates.every(c => c.evidence.every(e => e.type === 'baseline' || ownCellText.includes(e.source_text)));
    check('「標準仕様」列(公称20 kW)のevidenceが、同じ行の「参考値列」の文言("参考値"/"試験")を含まない(回帰4)',
      evidenceStaysWithinOwnCell(koushouCol, '公称20 kW'),
      koushouCol.interval_semantics_candidates.flatMap(c => c.evidence));
    check('「参考値列」(参考値25 kW、試験は非該当)のevidenceが、同じ行の「標準仕様」列の文言("公称")を含まない(回帰4)',
      evidenceStaysWithinOwnCell(sankoCol, '参考値25 kW、試験は非該当'),
      sankoCol.interval_semantics_candidates.flatMap(c => c.evidence));

    // 5. 列名だけを"検討結果"から中立名(neutral_col)へ変えても、強いキーワード根拠(セル内の文言由来)は変わらない
    const renamedRecords = [{ '設計項目': '達成値混在テスト', '標準仕様': '10 kW', 'neutral_col': '12.5 kWに変更' }];
    await loadWorkJson(page, workPackage(renamedRecords), fixtureDir);
    const runRenamed = await clickQuantityAnnotationButton(page, fixtureDir);
    const renamedAnalysis = runRenamed.sidecar.records[0].analyses.find(a => a.source_field === 'neutral_col');
    const achievedRenamed = renamedAnalysis.interval_semantics_candidates.find(c => c.value === 'achieved_point');
    // セル内容("12.5 kWに変更")自体にはkeyword根拠(0.4)を発火させる語が無いため、列名が"検討結果"でも
    // 中立名でもkeyword由来のevidenceは付かない、という点は共通のはず(強いキーワード根拠は
    // セルの実内容だけで決まり、列名では動かない、という回帰5の主旨)。列名一致由来の弱い
    // column_role根拠(0.05、ctx.sourceColumn === '検討結果'の場合のみ)は列名に連動して当然変わる
    // ため、ここでは比較対象に含めない。
    check('列名を"検討結果"から中立名に変えても、どちらもkeyword由来のevidenceを持たない(回帰5)',
      !achievedRenamed.evidence.some(e => e.type === 'keyword') && !achievedKentou.evidence.some(e => e.type === 'keyword'),
      { renamed: achievedRenamed.evidence, original: achievedKentou.evidence });

    // ── 6b. 数量ゼロ件の列はcolumn_role_candidatesに含まれない(中重大度の指摘への回帰テスト) ──
    const leakColumns = runLeak.sidecar.column_role_candidates.map(c => c.column);
    check('数量が1件も検出されない列(設計項目)はcolumn_role_candidatesに含まれない(中重大度)', !leakColumns.includes('設計項目'), leakColumns);
    check('数量が検出された列(標準仕様)はcolumn_role_candidatesに含まれる(中重大度)', leakColumns.includes('標準仕様'), leakColumns);
    check('数量が検出された列(検討結果)はcolumn_role_candidatesに含まれる(中重大度)', leakColumns.includes('検討結果'), leakColumns);
    const allBlankRecords = [{ '設計項目': 'A', '空列': '', '標準仕様': '10 kW' }, { '設計項目': 'B', '空列': '', '標準仕様': '11 kW' }];
    await loadWorkJson(page, workPackage(allBlankRecords), fixtureDir);
    const runAllBlank = await clickQuantityAnnotationButton(page, fixtureDir);
    check('全行で空欄の列(空列)はcolumn_role_candidatesに含まれない(中重大度)',
      !runAllBlank.sidecar.column_role_candidates.some(c => c.column === '空列'), runAllBlank.sidecar.column_role_candidates.map(c => c.column));

    // ── 8. 条件節 ──
    const rCond = runA.sidecar.records.find(r => r.analyses.some(a => a.is_condition_value === true));
    check('条件節(condition_candidates)がis_condition_value:trueの別analysesになる(8)', !!rCond);

    // ── 9. 同一スナップショット ──
    check('trace JSONとsidecarのgenerated_atが完全一致する(9)', runA.trace.generated_at === runA.sidecar.generated_at);
    const traceIds = new Set(runA.trace._trace_records.map(r => r.trace_id));
    const sidecarIds = new Set(runA.sidecar.records.map(r => r.trace_id));
    check('sidecarのtrace_id集合がtrace JSONのtrace_id集合と完全一致する(9)',
      traceIds.size === sidecarIds.size && [...traceIds].every(id => sidecarIds.has(id)));

    // ── 10. JSON Schema検証 ──
    const schemaResult = validate(SCHEMA, runA.sidecar);
    check('実際のExcel生成物がJSON Schema(quantity_annotation_schema_v1.json)を満たす(10)', schemaResult.valid, schemaResult.errors);

    // ── 11. 既存ボタン(buildTraceBtn・downloadJsonBtn)が影響を受けない ──
    // buildTraceBtnはprofileTab、downloadJsonBtnはimportTabに属する(タブが違うと非表示になるため、
    // クリック前にそれぞれのタブへ切り替える必要がある。これは既存UIの挙動そのもの)。
    await loadWorkJson(page, workPackage(BASE_RECORDS), fixtureDir);
    await page.click('#buildTraceBtn');
    await page.waitForTimeout(300);
    await page.click('[data-tab="importTab"]');
    await page.waitForTimeout(200);
    const [existingDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('#downloadJsonBtn'),
    ]);
    const existingPath = path.join(fixtureDir, '_tmp_existing_download.json');
    await existingDownload.saveAs(existingPath);
    const existingJson = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
    fs.unlinkSync(existingPath);
    check('既存のbuildTraceBtn+downloadJsonBtnの組み合わせが影響を受けず動作する(11)',
      Array.isArray(existingJson._trace_records) && existingJson._trace_records.length === BASE_RECORDS.length,
      { records: existingJson._trace_records?.length });

    check('検証中にページエラーが発生していない(ERR_TUNNEL_CONNECTION_FAILED等の無関係なネットワークエラーは許容)',
      pageErrors.every(e => /ERR_TUNNEL_CONNECTION_FAILED|net::/.test(e)), pageErrors);

    fs.writeFileSync(OUT_FIXTURE, JSON.stringify({ generated_at: new Date().toISOString(), sample_trace: runA.trace, sample_sidecar: runA.sidecar }, null, 2));
  });

  console.log('\n=== quantity_annotation_excel_verification 結果 ===');
  let fail = 0;
  for (const a of assertions) {
    console.log(`[${a.ok ? 'OK' : 'NG'}] ${a.name}`);
    if (!a.ok) { fail++; if (a.detail !== undefined) console.log('    detail:', JSON.stringify(a.detail)); }
  }
  console.log(`\n合計 ${assertions.length}件中 ${assertions.length - fail}件成功 / ${fail}件失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });

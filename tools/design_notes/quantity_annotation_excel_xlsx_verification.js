// フェーズA(数量注釈sidecar実装)Excel側の、実際の.xlsxファイルを経由した検証。
// quantity_annotation_excel_verification.js は「作業中JSON読込」(work_format:
// excel-json-work-v2)というツール自身の正規経路を使って検証しているが、これは.xlsx解析
// (XLSX.read())そのものを経由しない。レビューで、列順序・数値セル・数式セル・空欄・見出し正規化が
// .xlsx解析後にどう扱われるかは未検証だと指摘され、フェーズAの完了とはまだ扱えないとされた。
//
// このスクリプトは、実際に生成した.xlsxバイナリをXLSX.read()で解析させる経路を検証する。
// 2つの追加的な依存が必要になる(いずれも製品コード=tools/配下のツール本体には一切影響しない、
// このテストスクリプト実行時だけの依存。tools/design_notes/package.jsonを参照、事前にnpm ciが必要):
//   - playwright: 他の実ブラウザ検証スクリプトと同じ理由。
//   - xlsx: 実際の.xlsxバイナリを合成データから生成するため。ツール自身はCDN
//     (cdn.jsdelivr.net/npm/xlsx@0.18.5)からブラウザ側で読み込む設計のままであり、変更していない。
//     このサンドボックス環境ではCDNアクセスがネットワークポリシーで拒否されている
//     (cdn.jsdelivr.net/unpkg.com/cdnjs.cloudflare.comいずれも接続不可、実測確認済み)ため、
//     Playwrightのpage.route()でそのCDN URLへのリクエストをローカルの同一バージョンのSheetJS
//     コピー(npm経由、registry.npmjs.orgはネットワークポリシーで許可されている)へ差し替える。
//     製品HTML・依存ゼロ方針は変更しない。
'use strict';
const { chromium } = require('playwright');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const { validate } = require('./json_schema_minivalidator.js');

const REPO_ROOT = path.join(__dirname, '..', '..');
const TOOL = path.join(REPO_ROOT, 'tools/excel_to_json_conversion_tool_v2.0.8.html');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'quantity_annotation_schema_v1.json'), 'utf8'));
const XLSX_LIB_PATH = require.resolve('xlsx/dist/xlsx.full.min.js');
const OUT_FIXTURE = path.join(__dirname, 'runtime_fixtures', 'quantity_annotation_excel_xlsx_verified.json');

// ブラウザ側(CDN差し替え経由で読み込むコピー)とNode側(このスクリプトがrequireするコピー)が
// 同一バージョンのSheetJSであることを明示的に確認する(依存固定に関するレビュー指摘への対応。
// バージョンが食い違うと、Node側で合成した.xlsxをブラウザ側が異なる挙動で解析してしまう可能性がある)。
const XLSX_EXPECTED_VERSION = '0.18.5';

const assertions = [];
function check(name, ok, detail) { assertions.push({ name, ok: !!ok, detail }); }

function buildFixtureWorkbook(unitFormat) {
  // 列順序をわざと「検討結果」→「標準機種情報」→「設計項目」→管理列の順にする
  // (表内位置による役割候補の根拠が、配列の格納順ではなく実際のシート上の列順序から
  // 正しく計算されることを検証するため)。数式セル・単位付き表示形式の数値セル・
  // 単位のない通常数値セル・空欄・管理列も混在させる。
  const ws = XLSX.utils.aoa_to_sheet([
    ['検討結果', '標準機種情報', '設計項目', 'No', '数値セル(単位付き書式)', '数値セル(書式なし)'],
    ['12.5 kWに変更', '10 kW', '冷房能力', 1, 12.5, 99],
    ['変更なし', '', '付帯事項', 2, null, null],
    ['', '周囲温度50 °Cにおいて12.5 kWを実測', '実測条件', 3, 20, 100],
  ]);
  // 数式セル(A4): SheetJSがcellFormula:trueで読み取るキャッシュ済み文字列値
  ws['A4'] = { t: 'str', f: 'CONCATENATE("12.5"," kWを実測")', v: '12.5 kWを実測' };
  // 単位付き表示形式の数値セル(E2, E4): 数値としては12.5/20だが、セル書式により表示文字列は
  // "12.5 kW"のようになる(現場のExcel帳票で実際によくある、単位を書式側に持たせるパターン)。
  // unitFormat引数で単位表記を差し替えられるようにし、書式変更による陳腐化検出のテストに使う。
  const fmt = `0.0" ${unitFormat}"`;
  ws['E2'] = { t: 'n', v: 12.5, z: fmt };
  ws['E4'] = { t: 'n', v: 20, z: fmt };
  ws['E2'].w = XLSX.SSF.format(ws['E2'].z, ws['E2'].v);
  ws['E4'].w = XLSX.SSF.format(ws['E4'].z, ws['E4'].v);
  // 単位のない通常数値セル(F2, F4): 書式は既定(General)のまま。表示文字列も生値と同じ"99"/"100"に
  // なるはずで、単位が無いため数量として推測してはならない。
  ws['F2'] = { t: 'n', v: 99 };
  ws['F4'] = { t: 'n', v: 100 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '設計検討表');
  return wb;
}

async function withPage(fn) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));
  page.on('dialog', dialog => dialog.accept());
  await page.route('**://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', route => {
    route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(XLSX_LIB_PATH) });
  });
  await page.goto('file://' + TOOL);
  await page.waitForTimeout(300);
  try {
    return await fn(page, pageErrors);
  } finally {
    await browser.close();
  }
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
  const tp = path.join(tmpDir, `_tmp_trace_${Date.now()}.json`);
  const sp = path.join(tmpDir, `_tmp_sidecar_${Date.now()}.json`);
  await traceDl.saveAs(tp);
  await sidecarDl.saveAs(sp);
  const trace = JSON.parse(fs.readFileSync(tp, 'utf8'));
  const sidecar = JSON.parse(fs.readFileSync(sp, 'utf8'));
  fs.unlinkSync(tp); fs.unlinkSync(sp);
  return { trace, sidecar };
}

async function runXlsxScenario(page, fixtureDir, xlsxPath, profileName) {
  await page.setInputFiles('#excelFile', xlsxPath);
  await page.waitForTimeout(500);
  const importMsg = await page.evaluate(() => document.getElementById('importMessage').textContent);
  check('実.xlsxファイルの読み込みに成功する', /読み込み完了/.test(importMsg || ''), importMsg);
  await page.click('#convertBtn');
  await page.waitForTimeout(300);
  await page.click('[data-tab="profileTab"]');
  await page.waitForTimeout(200);
  await page.fill('#profileEditor', JSON.stringify({
    profile_name: profileName, profile_version: '1.0',
    output: { mode: 'array', preserve_unmapped: true },
    tag_policy: { mode: 'controlled', vocabulary_id: 't', tag_vocabulary_version: '1.0', allow_free_input: false, allowed_tags: [] },
  }, null, 2));
  return clickQuantityAnnotationButton(page, fixtureDir);
}

// 元trace(_trace_records、source_record_displayを含む)だけから、比較エンジン側が独立に
// dataset_signatureを再計算できることを検証する(v12ComputeDatasetSignature()と同一契約)。
function nodeRecomputeDatasetSignature(traceRecords) {
  const crypto = require('crypto');
  const NUL = String.fromCharCode(0);
  const normalize = v => String(v ?? '').normalize('NFKC').replace(/\r\n?/g, '\n').split('\n').map(s => s.replace(/[ \t]+$/g, '')).join('\n').replace(/[ \t]+/g, ' ').trim();
  const hashParts = (ns, parts) => crypto.createHash('sha256').update(Buffer.from([ns, ...parts.map(normalize)].join(NUL), 'utf8')).digest('hex');
  const canonical = v => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { o[k] = canonical(v[k]); }); return o; }
    return v;
  };
  const sorted = [...traceRecords].sort((a, b) => a.trace_id < b.trace_id ? -1 : a.trace_id > b.trace_id ? 1 : 0);
  return 'QA-SHA256:' + hashParts('dataset-signature-v1', [JSON.stringify(canonical(sorted))]);
}

(async () => {
  const fixtureDir = path.join(__dirname, 'runtime_fixtures');
  fs.mkdirSync(fixtureDir, { recursive: true });
  const xlsxPathKw = path.join(fixtureDir, '_tmp_quantity_annotation_excel_fixture_kw.xlsx');
  const xlsxPathKpa = path.join(fixtureDir, '_tmp_quantity_annotation_excel_fixture_kpa.xlsx');
  XLSX.writeFile(buildFixtureWorkbook('kW'), xlsxPathKw);
  XLSX.writeFile(buildFixtureWorkbook('kPa'), xlsxPathKpa);

  check('Node側requireしたxlsxパッケージのバージョンが期待どおり(ブラウザ側CDN差し替えコピーと同一)',
    require('xlsx/package.json').version === XLSX_EXPECTED_VERSION, require('xlsx/package.json').version);

  let mainRun;
  await withPage(async (page, pageErrors) => {
    const xlsxDefined = await page.evaluate(() => typeof XLSX);
    check('CDNルート差し替えでXLSXライブラリが読み込まれる(route()によるローカルSheetJS差し替え)', xlsxDefined === 'object', xlsxDefined);
    const browserXlsxVersion = await page.evaluate(() => XLSX.version);
    check('ブラウザ側(CDN差し替え経由)のXLSXバージョンがNode側と一致する', browserXlsxVersion === XLSX_EXPECTED_VERSION, browserXlsxVersion);

    mainRun = await runXlsxScenario(page, fixtureDir, xlsxPathKw, 'xlsxtest');

    const run = mainRun;
    check('trace JSONとsidecarのgenerated_atが完全一致する(実.xlsx経由でも同一スナップショット)', run.trace.generated_at === run.sidecar.generated_at);
    check('実.xlsx生成物がJSON Schemaを満たす', validate(SCHEMA, run.sidecar).valid, validate(SCHEMA, run.sidecar).errors);

    const rowByDesignItem = name => run.trace._trace_records.find(r => r.source_record['設計項目'] === name);
    const analysesOf = traceId => run.sidecar.records.find(r => r.trace_id === traceId)?.analyses || [];

    // 列順序が役割候補の位置根拠(baseline列からの距離)へ正しく反映されること。
    const kentouRole = run.sidecar.column_role_candidates.find(c => c.column === '検討結果');
    check('実.xlsxの列順序(検討結果が標準機種情報より左)では、検討結果にposition_near_baselineが付かない(列順序が正しく反映されている)',
      kentouRole && !kentouRole.role_candidates.some(c => c.evidence.some(e => e.type === 'position_near_baseline')), kentouRole);

    // 管理列(No)が除外される
    const anyAnalyses = run.sidecar.records.flatMap(r => r.analyses.map(a => a.source_field));
    check('管理列(No)が実.xlsx経由でも除外される', !anyAnalyses.includes('No'));
    check('管理列(No)がcolumn_role_candidatesにも含まれない', !run.sidecar.column_role_candidates.some(c => c.column === 'No'));

    // 数式セル(A4、キャッシュ済み文字列値"12.5 kWを実測")から数量が抽出される
    const jissokuRow = rowByDesignItem('実測条件');
    check('数式セル(検討結果、キャッシュ済み文字列値)から数量が抽出される', jissokuRow && analysesOf(jissokuRow.trace_id).some(a => a.source_field === '検討結果' && a.normalized_text.includes('12.5')), jissokuRow && analysesOf(jissokuRow.trace_id));

    // 【レビュー指摘の主要な回帰テスト】既定設定(preserveTypes=true)のまま、単位付き書式の
    // 数値セル(生値12.5、書式"0.0\" kW\""、表示"12.5 kW")から数量を抽出できること。
    const reikyakuRow = rowByDesignItem('冷房能力');
    const unitCellAnalyses = reikyakuRow ? analysesOf(reikyakuRow.trace_id).filter(a => a.source_field === '数値セル(単位付き書式)') : [];
    check('既定設定(preserveTypes=true)のまま、単位付き書式の数値セル("12.5"+"0.0\\" kW\\""形式)から数量を抽出する(回帰1)',
      unitCellAnalyses.length > 0 && unitCellAnalyses.some(a => a.normalized_text.includes('12.5')), unitCellAnalyses);
    check('表示文字列由来であることがsource_representation:"formatted_display"から判別できる(回帰4)',
      unitCellAnalyses.every(a => a.source_representation === 'formatted_display' && a.source_value_text === '12.5 kW'), unitCellAnalyses);

    // trace側のraw_value由来の数量(検討結果・標準機種情報、もともと文字列セル)はsource_representation
    // が"raw_value"のままであることも合わせて確認する(既存の文字列セル処理への非退行確認)。
    const kentouAnalysis = analysesOf(reikyakuRow.trace_id).find(a => a.source_field === '検討結果');
    check('文字列セル由来の数量はsource_representation:"raw_value"のまま(非退行確認)',
      kentouAnalysis && kentouAnalysis.source_representation === 'raw_value', kentouAnalysis);

    // 単位のない通常数値セルは、書式の有無に関わらず表示文字列も生値と同じ("99")になるため、
    // 推測で数量化されないままであること(回帰3)。
    const plainNumCellAnalyses = reikyakuRow ? analysesOf(reikyakuRow.trace_id).filter(a => a.source_field === '数値セル(書式なし)') : [];
    check('単位のない通常数値セルは推測で数量化されない(回帰3)', plainNumCellAnalyses.length === 0, plainNumCellAnalyses);

    // 空欄セル(標準機種情報、2行目"付帯事項")は数量ゼロで正常に扱われる
    const futaiRow = rowByDesignItem('付帯事項');
    check('空欄セルを含む行でもエラーにならない', !!futaiRow);

    // 【レビュー指摘の回帰テスト】元trace(_trace_records)だけから、比較エンジン側が独立に
    // dataset_signatureを再計算できること(source_record_displayを含めた契約の検証)。
    const recomputed = nodeRecomputeDatasetSignature(run.trace._trace_records);
    check('元trace(_trace_records、source_record_display込み)だけから独立に再計算したdataset_signatureが、実際のsidecarの値と一致する(回帰5)',
      recomputed === run.sidecar.dataset_signature, { recomputed, actual: run.sidecar.dataset_signature });

    // trace側にsource_record_displayが実際に含まれていること(比較エンジン側が表示文字列由来の
    // 陳腐化を検出するために必要な情報が、sidecarだけでなく元trace側にもあることの確認)。
    check('trace._trace_recordsにsource_record_displayが含まれる', reikyakuRow && reikyakuRow.source_record_display && reikyakuRow.source_record_display['数値セル(単位付き書式)'] === '12.5 kW', reikyakuRow?.source_record_display);

    check('検証中にページエラーが発生していない(ERR_TUNNEL_CONNECTION_FAILED等の無関係なネットワークエラーは許容)',
      pageErrors.every(e => /ERR_TUNNEL_CONNECTION_FAILED|net::/.test(e)), pageErrors);

    fs.writeFileSync(OUT_FIXTURE, JSON.stringify({ generated_at: new Date().toISOString(), sample_trace: run.trace, sample_sidecar: run.sidecar }, null, 2));
  });

  // ── 【レビュー指摘の回帰テスト】生値は変えずセル書式だけをkW→kPaへ変更すると、
  //    content_hash・dataset_signature・抽出される単位のいずれも変わることを確認する("W"は
  //    quantity_extraction_prototype.jsのUNIT_ALTに含まれない単位のため、抽出自体が成立しなくなり
  //    「単位が変わったこと」の検証にならない。UNIT_ALTに含まれる別の単位"kPa"を使う)。
  await withPage(async (page, pageErrors) => {
    const runKpa = await runXlsxScenario(page, fixtureDir, xlsxPathKpa, 'xlsxtest_kpa');
    const reikyakuRowKw = mainRun.trace._trace_records.find(r => r.source_record['設計項目'] === '冷房能力');
    const reikyakuRowKpa = runKpa.trace._trace_records.find(r => r.source_record['設計項目'] === '冷房能力');
    const recordKw = mainRun.sidecar.records.find(r => r.trace_id === reikyakuRowKw.trace_id);
    const recordKpa = runKpa.sidecar.records.find(r => r.trace_id === reikyakuRowKpa.trace_id);

    check('生値は変えず書式だけkW→kPaへ変更しても、行のcontent_hashが変わる(回帰2)', recordKw.content_hash !== recordKpa.content_hash, { kw: recordKw.content_hash, kpa: recordKpa.content_hash });
    check('生値は変えず書式だけkW→kPaへ変更すると、dataset_signatureも変わる(回帰2)', mainRun.sidecar.dataset_signature !== runKpa.sidecar.dataset_signature, { kw: mainRun.sidecar.dataset_signature, kpa: runKpa.sidecar.dataset_signature });

    const unitCellAnalysesKpa = runKpa.sidecar.records.find(r => r.trace_id === reikyakuRowKpa.trace_id).analyses.filter(a => a.source_field === '数値セル(単位付き書式)');
    check('書式変更後は抽出される単位も"kPa"になる(回帰2)', unitCellAnalysesKpa.some(a => a.quantity.unit.canonical === 'kPa' || a.quantity.unit.source === 'kPa'), unitCellAnalysesKpa);

    check('生値(数値)自体は書式変更の前後で変わらない(source_recordの生値は維持する契約)',
      reikyakuRowKw.source_record['数値セル(単位付き書式)'] === reikyakuRowKpa.source_record['数値セル(単位付き書式)'],
      { kw: reikyakuRowKw.source_record['数値セル(単位付き書式)'], kpa: reikyakuRowKpa.source_record['数値セル(単位付き書式)'] });

    check('パート2実行中にページエラーが発生していない',
      pageErrors.every(e => /ERR_TUNNEL_CONNECTION_FAILED|net::/.test(e)), pageErrors);
  });

  // ── preserveTypesを外した場合も、単位付き書式の数値セルの表示文字列("12.5 kW")から
  //    数量として抽出できることを確認する(既定・非既定どちらでも動くことの非退行確認)。
  await withPage(async (page, pageErrors) => {
    await page.setInputFiles('#excelFile', xlsxPathKw);
    await page.waitForTimeout(500);
    await page.uncheck('#preserveTypes');
    await page.click('#convertBtn');
    await page.waitForTimeout(300);
    await page.click('[data-tab="profileTab"]');
    await page.waitForTimeout(200);
    await page.fill('#profileEditor', JSON.stringify({
      profile_name: 'xlsxtest2', profile_version: '1.0',
      output: { mode: 'array', preserve_unmapped: true },
      tag_policy: { mode: 'controlled', vocabulary_id: 't', tag_vocabulary_version: '1.0', allow_free_input: false, allowed_tags: [] },
    }, null, 2));
    const run = await clickQuantityAnnotationButton(page, fixtureDir);
    const reikyakuRow = run.trace._trace_records.find(r => r.source_record['設計項目'] === '冷房能力');
    const analyses = run.sidecar.records.find(r => r.trace_id === reikyakuRow?.trace_id)?.analyses || [];
    check('preserveTypesを外しても、単位付き書式の数値セルの表示文字列("12.5 kW")から数量が抽出される(非退行確認)',
      reikyakuRow && analyses.some(a => a.source_field === '数値セル(単位付き書式)' && a.normalized_text.includes('12.5')), analyses);
    check('パート3実行中にページエラーが発生していない',
      pageErrors.every(e => /ERR_TUNNEL_CONNECTION_FAILED|net::/.test(e)), pageErrors);
  });

  fs.unlinkSync(xlsxPathKw);
  fs.unlinkSync(xlsxPathKpa);

  console.log('\n=== quantity_annotation_excel_xlsx_verification 結果 ===');
  let fail = 0;
  for (const a of assertions) {
    console.log(`[${a.ok ? 'OK' : 'NG'}] ${a.name}`);
    if (!a.ok) { fail++; if (a.detail !== undefined) console.log('    detail:', JSON.stringify(a.detail)); }
  }
  console.log(`\n合計 ${assertions.length}件中 ${assertions.length - fail}件成功 / ${fail}件失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });

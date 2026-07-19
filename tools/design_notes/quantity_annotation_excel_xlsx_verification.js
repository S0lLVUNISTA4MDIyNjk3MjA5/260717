// フェーズA(数量注釈sidecar実装)Excel側の、実際の.xlsxファイルを経由した検証。
// quantity_annotation_excel_verification.js は「作業中JSON読込」(work_format:
// excel-json-work-v2)というツール自身の正規経路を使って検証しているが、これは.xlsx解析
// (XLSX.read())そのものを経由しない。レビューで、列順序・数値セル・数式セル・空欄・見出し正規化が
// .xlsx解析後にどう扱われるかは未検証だと指摘され、フェーズAの完了とはまだ扱えないとされた。
//
// このスクリプトは、実際に生成した.xlsxバイナリをXLSX.read()で解析させる経路を検証する。
// 2つの追加的な依存が必要になる(いずれも製品コード=tools/配下のツール本体には一切影響しない、
// このテストスクリプト実行時だけの依存。tools/design_notes/package.jsonを参照、事前にnpm installが必要):
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

const assertions = [];
function check(name, ok, detail) { assertions.push({ name, ok: !!ok, detail }); }

function buildFixtureWorkbook() {
  // 列順序をわざと「検討結果」→「標準機種情報」→「設計項目」→管理列の順にする
  // (表内位置による役割候補の根拠が、配列の格納順ではなく実際のシート上の列順序から
  // 正しく計算されることを検証するため)。数式セル・単位付き表示形式の数値セル・空欄・
  // 管理列も混在させる。
  const ws = XLSX.utils.aoa_to_sheet([
    ['検討結果', '標準機種情報', '設計項目', 'No', '数値セル(単位付き書式)'],
    ['12.5 kWに変更', '10 kW', '冷房能力', 1, 12.5],
    ['変更なし', '', '付帯事項', 2, null],
    ['', '周囲温度50 °Cにおいて12.5 kWを実測', '実測条件', 3, 20],
  ]);
  // 数式セル(A4): SheetJSがcellFormula:trueで読み取るキャッシュ済み文字列値
  ws['A4'] = { t: 'str', f: 'CONCATENATE("12.5"," kWを実測")', v: '12.5 kWを実測' };
  // 単位付き表示形式の数値セル(E2, E4): 数値としては12.5/20だが、セル書式により表示文字列は
  // "12.5 kW"のようになる(現場のExcel帳票で実際によくある、単位を書式側に持たせるパターン)。
  ws['E2'] = { t: 'n', v: 12.5, z: '0.0" kW"' };
  ws['E4'] = { t: 'n', v: 20, z: '0.0" kW"' };
  ws['E2'].w = XLSX.SSF.format(ws['E2'].z, ws['E2'].v);
  ws['E4'].w = XLSX.SSF.format(ws['E4'].z, ws['E4'].v);
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

(async () => {
  const fixtureDir = path.join(__dirname, 'runtime_fixtures');
  fs.mkdirSync(fixtureDir, { recursive: true });
  const xlsxPath = path.join(fixtureDir, '_tmp_quantity_annotation_excel_fixture.xlsx');
  XLSX.writeFile(buildFixtureWorkbook(), xlsxPath);

  await withPage(async (page, pageErrors) => {
    const xlsxDefined = await page.evaluate(() => typeof XLSX);
    check('CDNルート差し替えでXLSXライブラリが読み込まれる(route()によるローカルSheetJS差し替え)', xlsxDefined === 'object', xlsxDefined);

    await page.setInputFiles('#excelFile', xlsxPath);
    await page.waitForTimeout(500);
    const importMsg = await page.evaluate(() => document.getElementById('importMessage').textContent);
    check('実.xlsxファイルの読み込みに成功する', /読み込み完了/.test(importMsg || ''), importMsg);

    await page.click('#convertBtn');
    await page.waitForTimeout(300);

    await page.click('[data-tab="profileTab"]');
    await page.waitForTimeout(200);
    const profile = {
      profile_name: 'xlsxtest', profile_version: '1.0',
      output: { mode: 'array', preserve_unmapped: true },
      tag_policy: { mode: 'controlled', vocabulary_id: 't', tag_vocabulary_version: '1.0', allow_free_input: false, allowed_tags: [] },
    };
    await page.fill('#profileEditor', JSON.stringify(profile, null, 2));

    const run = await clickQuantityAnnotationButton(page, fixtureDir);

    check('trace JSONとsidecarのgenerated_atが完全一致する(実.xlsx経由でも同一スナップショット)', run.trace.generated_at === run.sidecar.generated_at);
    check('実.xlsx生成物がJSON Schemaを満たす', validate(SCHEMA, run.sidecar).valid, validate(SCHEMA, run.sidecar).errors);

    const rowByDesignItem = name => run.trace._trace_records.find(r => r.source_record['設計項目'] === name);
    const analysesOf = traceId => run.sidecar.records.find(r => r.trace_id === traceId)?.analyses || [];

    // 列順序が役割候補の位置根拠(baseline列からの距離)へ正しく反映されること。
    // このfixtureでは列順序が「検討結果(0)→標準機種情報(1)→設計項目(2)」であり、標準機種情報の
    // 右隣・近傍にresolved系の列が無い(検討結果はbaseline列より左)ため、検討結果には
    // position_near_baselineが付かない、というのが実際のシート上の列順序に従った場合の正しい結果。
    // (作業中JSON経由のquantity_annotation_excel_verification.jsでは逆順で配置しており、
    // そちらではposition_near_baselineが付くことを確認済み。両方を突き合わせることで、
    // 位置根拠が配列の格納順ではなく実際の列順序から計算されていることを検証する)
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

    // 数値型セル(preserveTypes=true、既定)は生の数値のまま渡され、単位が無いため
    // 意図的に数量として抽出されない(quantity_extraction_prototype.jsの既存の仕様、
    // 単位を伴わない裸の数値を数量と誤認しない設計。バグではなく、既定設定での正しい挙動)。
    const reikyakuRow = rowByDesignItem('冷房能力');
    check('数値型セル(preserveTypes=true既定、単位書式が失われ裸の数値になる)からは数量を抽出しない(quantity_extraction_prototype.jsの既存仕様どおり)',
      reikyakuRow && !analysesOf(reikyakuRow.trace_id).some(a => a.source_field === '数値セル(単位付き書式)'), reikyakuRow && analysesOf(reikyakuRow.trace_id));

    // 空欄セル(標準機種情報、2行目"付帯事項")は数量ゼロで正常に扱われる
    const futaiRow = rowByDesignItem('付帯事項');
    check('空欄セルを含む行でもエラーにならない', !!futaiRow);

    check('検証中にページエラーが発生していない(ERR_TUNNEL_CONNECTION_FAILED等の無関係なネットワークエラーは許容)',
      pageErrors.every(e => /ERR_TUNNEL_CONNECTION_FAILED|net::/.test(e)), pageErrors);

    fs.writeFileSync(OUT_FIXTURE, JSON.stringify({ generated_at: new Date().toISOString(), sample_trace: run.trace, sample_sidecar: run.sidecar }, null, 2));
  });

  // ── preserveTypesを外した場合(数値・真偽値を保持のチェックを外す)、単位付き書式の
  //    数値セルの表示文字列("12.5 kW")が渡され、数量として抽出できることを確認する。
  //    これにより「数値型セルからの数量抽出」がツールの設定次第で実際に可能であることを示す。
  await withPage(async (page, pageErrors) => {
    await page.route('**://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js', route => {
      route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(XLSX_LIB_PATH) });
    });
    await page.setInputFiles('#excelFile', xlsxPath);
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
    check('preserveTypesを外すと、単位付き書式の数値セルの表示文字列("12.5 kW")から数量が抽出される',
      reikyakuRow && analyses.some(a => a.source_field === '数値セル(単位付き書式)' && a.normalized_text.includes('12.5')), analyses);
    check('パート2実行中にページエラーが発生していない',
      pageErrors.every(e => /ERR_TUNNEL_CONNECTION_FAILED|net::/.test(e)), pageErrors);
  });

  fs.unlinkSync(xlsxPath);

  console.log('\n=== quantity_annotation_excel_xlsx_verification 結果 ===');
  let fail = 0;
  for (const a of assertions) {
    console.log(`[${a.ok ? 'OK' : 'NG'}] ${a.name}`);
    if (!a.ok) { fail++; if (a.detail !== undefined) console.log('    detail:', JSON.stringify(a.detail)); }
  }
  console.log(`\n合計 ${assertions.length}件中 ${assertions.length - fail}件成功 / ${fail}件失敗`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });

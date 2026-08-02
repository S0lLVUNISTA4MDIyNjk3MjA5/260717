#!/usr/bin/env node
/* Knowledge Data Builder Alpha 0.2.0 Checkpoint 3a - pdf_direct_adapter.js pure-function
 * verification (Node, no browser). Exercises inspectPdf/extractPdfLayout/segmentPdfContent/
 * buildKnowledgeNodesFromPdf/adaptPdfDirect directly against the fixtures in ./fixtures/,
 * independent of the UI (this checkpoint does not wire the PDF adapter into the UI at all).
 * Run: node tools/knowledge_builder/verification/pdf_direct_adapter_verification.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Adapter = require('../core/pdf_direct_adapter.js');
const Store = require('../core/knowledge_store.js');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
function fx(name) { return path.join(FIXTURES_DIR, name); }

const FIXTURE_1 = fx('pdf_direct_fixture_1_no_heading_two_paragraphs.pdf');
const FIXTURE_2 = fx('pdf_direct_fixture_2_numbered_headings.pdf');
const FIXTURE_3 = fx('pdf_direct_fixture_3_two_pages_heading_each.pdf');
const FIXTURE_4 = fx('pdf_direct_fixture_4_body_before_heading.pdf');
const FIXTURE_5 = fx('pdf_direct_fixture_5_short_line_not_heading.pdf');
const FIXTURE_6 = fx('pdf_direct_fixture_6_blank_page.pdf');
const FIXTURE_7 = fx('pdf_direct_fixture_7_all_blank.pdf');
const FIXTURE_8 = fx('pdf_direct_fixture_8_corrupted.pdf');
const FIXTURE_9 = fx('pdf_direct_fixture_9_same_text_diff_fontsize.pdf');
const FIXTURE_10 = fx('pdf_direct_fixture_10_tag_match.pdf');
const FIXTURE_11_ENCRYPTED = fx('pdf_direct_fixture_11_encrypted.pdf');

const TAG_VOCAB = { allowed_tags: ['安全', '性能', '機能', '品質'], aliases: {} };

let failures = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else console.log(`PASS: ${message}`);
}

function readAsArrayBuffer(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function sha256Hex(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function adaptFixture(filePath, overrides) {
  const ab = readAsArrayBuffer(filePath);
  return Adapter.adaptPdfDirect(ab, Object.assign({
    fileName: path.basename(filePath), contentDigest: sha256Hex(filePath),
    ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
  }, overrides || {}));
}

async function expectThrow(promise) {
  try { await promise; return null; } catch (e) { return e; }
}

async function main() {
  // ---- #1/#2: 同じPDFを2回処理してNode ID集合・knowledge hash集合が一致(決定性) ----
  const r1 = await adaptFixture(FIXTURE_2);
  const r2 = await adaptFixture(FIXTURE_2);
  const ids1 = r1.nodes.map(n => n.node_id).sort();
  const ids2 = r2.nodes.map(n => n.node_id).sort();
  assert(ids1.length > 0 && JSON.stringify(ids1) === JSON.stringify(ids2),
    `同じPDFを2回処理してもNode ID集合が一致する(実際件数: ${ids1.length})`);
  const hashes1 = r1.nodes.map(n => n.revision.knowledge_hash).sort();
  const hashes2 = r2.nodes.map(n => n.revision.knowledge_hash).sort();
  assert(JSON.stringify(hashes1) === JSON.stringify(hashes2), '同じPDFを2回処理してもknowledge_hash集合が一致する');
  assert(r1.nodes.every(n => typeof n.revision.knowledge_hash === 'string' && /^[0-9a-f]{64}$/.test(n.revision.knowledge_hash)),
    'knowledge_hashはid_hash_utils.jsの正本nodeKnowledgeHash()が生成した64桁hexである');

  // ---- #3: document Node 1件 ----
  assert(r1.nodes.filter(n => n.node_type === 'document').length === 1, 'document Nodeは1件だけ生成される');

  // ---- #4: 見出し数どおりsection Node生成(fixture 2: 番号付き見出し2件) ----
  const secNodes1 = r1.nodes.filter(n => n.node_type === 'section');
  assert(secNodes1.length === 2 && secNodes1.map(n => n.title).join(',') === '1. 概要,1.2 適用範囲',
    `見出し数どおりsection Nodeが生成される(実際: ${JSON.stringify(secNodes1.map(n => n.title))})`);

  // ---- #5: 見出しなしの場合synthetic「本文」1件(fixture 1) ----
  const rNoHeading = await adaptFixture(FIXTURE_1);
  const secNoHeading = rNoHeading.nodes.filter(n => n.node_type === 'section');
  assert(secNoHeading.length === 1 && secNoHeading[0].title === '本文' && secNoHeading[0].provenance.extensions.synthetic === true,
    `見出しがない文書はsynthetic「本文」sectionが1件だけ生成される(実際: ${JSON.stringify(secNoHeading.map(n => ({ title: n.title, synthetic: n.provenance.extensions.synthetic })))})`);
  assert(rNoHeading.nodes.filter(n => n.node_type === 'statement').length === 2,
    'fixture1(2段落)は非結合の2段落が別々に十分離れているため2件のstatementになる');

  // ---- 見出し前に本文が存在(fixture 4): synthetic「本文」+ 実見出しsectionの両方が生成される ----
  const rBodyBefore = await adaptFixture(FIXTURE_4);
  const secBodyBefore = rBodyBefore.nodes.filter(n => n.node_type === 'section');
  assert(secBodyBefore.length === 2 && secBodyBefore[0].title === '本文' && secBodyBefore[0].provenance.extensions.synthetic === true &&
    secBodyBefore[1].title === '1. 概要' && secBodyBefore[1].provenance.extensions.synthetic === false,
    `見出し前に本文がある場合、synthetic「本文」の後に実見出しsectionが続く(実際: ${JSON.stringify(secBodyBefore.map(n => n.title))})`);

  // ---- #6: 全statementが正しいsectionをparentに持つ ----
  const docNode1 = r1.nodes.find(n => n.node_type === 'document');
  assert(secNodes1.every(s => s.parent_node_id === docNode1.node_id), '全section Nodeのparentはdocument Node');
  for (const sec of secNodes1) {
    const children = r1.nodes.filter(n => n.node_type === 'statement' && n.parent_node_id === sec.node_id);
    assert(children.length > 0, `section「${sec.title}」に少なくとも1件のstatementが属する`);
  }
  assert(r1.nodes.filter(n => n.node_type === 'statement').every(n => secNodes1.some(s => s.node_id === n.parent_node_id)),
    '全statementのparent_node_idはこの文書のいずれかのsection Nodeを指す');

  // ---- #7: ページ番号が正しい(fixture 3: 2ページ、ページごとに見出しと段落) ----
  const r3 = await adaptFixture(FIXTURE_3);
  const secs3 = r3.nodes.filter(n => n.node_type === 'section');
  const stmts3 = r3.nodes.filter(n => n.node_type === 'statement');
  assert(secs3[0].provenance.locator.page === 1 && secs3[1].provenance.locator.page === 2,
    `section Nodeのpageが正しい(実際: ${secs3.map(s => s.provenance.locator.page)})`);
  assert(stmts3[0].provenance.locator.page === 1 && stmts3[1].provenance.locator.page === 2,
    `statement Nodeのpageが正しい(実際: ${stmts3.map(s => s.provenance.locator.page)})`);
  assert(stmts3[0].provenance.extensions.page_index === 0 && stmts3[1].provenance.extensions.page_index === 1,
    'provenance.extensions.page_indexは0始まりで正しい');
  // ページを越えて段落結合しないことも確認(2文書とも別statementのまま)
  assert(stmts3.length === 2, `ページを越えて段落が結合されない(実際のstatement数: ${stmts3.length})`);

  // ---- #8: source_raw_textが原文と一致 ----
  const mergedStmt = rNoHeading.nodes.find(n => n.node_type === 'statement' && n.title.includes('この文書には見出しがありません'));
  assert(mergedStmt.provenance.verbatim.source_raw_text === 'この文書には見出しがありません。\n最初の段落の二行目です。',
    `結合された段落のsource_raw_textは改行を含む原文と完全一致する(実際: ${JSON.stringify(mergedStmt.provenance.verbatim.source_raw_text)})`);
  assert(mergedStmt.text !== mergedStmt.provenance.verbatim.source_raw_text,
    'Node.text(正規化後)はprovenance.verbatim.source_raw_text(原文)と混同されない(別の文字列)');

  // ---- #9: bboxが保持される ----
  assert(mergedStmt.provenance.extensions.bbox && mergedStmt.provenance.extensions.bbox.length === 4 &&
    mergedStmt.provenance.extensions.bbox.every(v => typeof v === 'number' && !Number.isNaN(v) && v >= 0 && v <= 1),
    `bboxが正規化された数値4要素として保持される(実際: ${JSON.stringify(mergedStmt.provenance.extensions.bbox)})`);
  assert(mergedStmt.provenance.extensions.line_count === 2, `line_countが結合された行数(2)と一致する(実際: ${mergedStmt.provenance.extensions.line_count})`);

  // ---- #10: 低信頼見出しをsection化しない(fixture 9: 大フォント非パターン行/小フォント見出し) ----
  const r9 = await adaptFixture(FIXTURE_9);
  const secs9 = r9.nodes.filter(n => n.node_type === 'section');
  assert(secs9.some(s => s.title === '本文') && secs9.some(s => s.title === '1. 概要') && secs9.length === 2,
    `大フォントでもパターン非一致の行(会社案内)はsection化されない(実際section: ${JSON.stringify(secs9.map(s => s.title))})`);
  assert(r9.nodes.some(n => n.node_type === 'statement' && n.title === '会社案内'),
    '大フォントの非パターン行は通常のstatementとして保持される(見出し化されない)');
  const smallFontHeadingSec = secs9.find(s => s.title === '1. 概要');
  assert(!!smallFontHeadingSec, `小フォントでも番号パターンに一致する行はsection化される(実際: ${JSON.stringify(secs9.map(s => s.title))})`);

  // ---- 短い行だが見出しではない(fixture 5) ----
  const r5 = await adaptFixture(FIXTURE_5);
  const secs5 = r5.nodes.filter(n => n.node_type === 'section');
  assert(secs5.length === 1 && secs5[0].title === '1. 概要',
    `固定パターンに一致しない短い行(以上)はsection化されない(実際section: ${JSON.stringify(secs5.map(s => s.title))})`);
  assert(r5.nodes.some(n => n.node_type === 'statement' && n.title === '以上'),
    '短い非パターン行(以上)は通常のstatementとして保持される');

  // ---- #11: 空白ページが警告となる(fixture 6) ----
  const r6 = await adaptFixture(FIXTURE_6);
  assert(r6.warnings.some(w => w.code === 'page_extracted_text_empty' && w.page === 2),
    `空白ページ(2ページ目)がpage_extracted_text_empty警告になる(実際: ${JSON.stringify(r6.warnings)})`);
  const secs6 = r6.nodes.filter(n => n.node_type === 'section');
  assert(secs6[0].provenance.locator.page === 1 && secs6[1].provenance.locator.page === 3,
    `空白ページを挟んでもページ番号は正しく維持される(実際: ${secs6.map(s => s.provenance.locator.page)})`);

  // ---- #12: 全ページtext 0でERROR(fixture 7) ----
  const err7 = await expectThrow(adaptFixture(FIXTURE_7));
  assert(!!err7 && err7.code === 'no_extractable_text',
    `全ページ抽出テキスト0文字はERRORになる(実際: threw=${!!err7}, code=${err7 && err7.code})`);

  // ---- #13: 壊れたPDFでERROR(fixture 8) ----
  const err8 = await expectThrow(adaptFixture(FIXTURE_8));
  assert(!!err8 && err8.code === 'pdf_parse_failed',
    `壊れたPDFはERRORになる(実際: threw=${!!err8}, code=${err8 && err8.code})`);

  // ---- 暗号化/パスワード要求でERROR(fixture 11) ----
  const err11 = await expectThrow(adaptFixture(FIXTURE_11_ENCRYPTED));
  assert(!!err11 && err11.code === 'pdf_encrypted_or_password_required',
    `暗号化/パスワード要求PDFはERRORになる(実際: threw=${!!err11}, code=${err11 && err11.code})`);

  // ---- #14: タグ一致(fixture 10: 完全一致は付与、部分一致は付与しない) ----
  const r10 = await adaptFixture(FIXTURE_10);
  const exactTagStmt = r10.nodes.find(n => n.node_type === 'statement' && n.title === '安全');
  const partialTagStmt = r10.nodes.find(n => n.node_type === 'statement' && n.title.includes('安全性能'));
  assert(!!exactTagStmt && exactTagStmt.tags.includes('安全'), `完全一致の段落(「安全」)にタグが付与される(実際: ${JSON.stringify(exactTagStmt && exactTagStmt.tags)})`);
  assert(!!partialTagStmt && partialTagStmt.tags.length === 0,
    `部分一致(「安全性能を重視する」)は「安全」を含んでいてもタグ付与されない(禁止: 部分単語一致)(実際: ${JSON.stringify(partialTagStmt && partialTagStmt.tags)})`);

  // ---- タグ: NFKC正規化・ASCII大文字小文字無視の確認(禁止: 部分一致・類義語・編集距離) ----
  assert(JSON.stringify(Adapter.matchInitialTags(['ＡＢＣ'], { allowed_tags: ['ABC'], aliases: {} })) === JSON.stringify(['ABC']),
    '全角英字はNFKC正規化により半角と同一視される');
  assert(JSON.stringify(Adapter.matchInitialTags(['abc'], { allowed_tags: ['ABC'], aliases: {} })) === JSON.stringify(['ABC']),
    'ASCII大文字小文字は無視して一致する(保存されるのは語彙側の正式表記)');
  assert(Adapter.matchInitialTags(['安全そう'], { allowed_tags: ['安全'], aliases: {} }).length === 0,
    '部分一致(安全そう)は誤って一致させない');

  // ---- #15: export_bindingが全件null ----
  assert(r1.nodes.every(n => n.export_binding === null) && r2.nodes.every(n => n.export_binding === null),
    '全Node(document/section/statement)のexport_bindingがnull');

  // ---- #16: Node/Edge ID重複0 ----
  {
    const nodeIdSet = new Set(r3.nodes.map(n => n.node_id));
    assert(nodeIdSet.size === r3.nodes.length, `Node IDの重複が0件(実際: 総数${r3.nodes.length}/ユニーク${nodeIdSet.size})`);
    const edgeIdSet = new Set(r3.edges.map(e => e.edge_id));
    assert(edgeIdSet.size === r3.edges.length, `edge_idの重複が0件(実際: 総数${r3.edges.length}/ユニーク${edgeIdSet.size})`);
    assert(r3.edges.length === r3.nodes.length - 1,
      `構造Edge(contains)数はNode数-1(document起点の木構造)と一致する(実際: edges=${r3.edges.length}, nodes=${r3.nodes.length})`);
    assert(r3.edges.every(e => e.relation_category === 'structural' && e.relation_type === 'contains'),
      '全Edgeはstructural/containsである');
  }

  // ---- #17: Contract validation PASS ----
  {
    const dataset = Store.createEmptyDataset({ tool: 'pdf_direct_adapter_verification', version: '0.2.0-alpha' });
    await Store.setTagVocabulary(dataset, { schema: 'trace-tag-vocabulary/1.0', vocabulary_id: 'test', vocabulary_version: '1.0.0', ...TAG_VOCAB });
    await Store.ingestAdapterResult(dataset, r3, { type: 'ai', id: 'pdf-direct-adapter' });
    await Store.finalizeDataset(dataset);
    const errorDiagnostics = dataset.diagnostics.filter(d => d.severity === 'error');
    assert(errorDiagnostics.length === 0, `PDF直接入力の結果をKnowledgeStoreへ取り込んでもContract validation errorが0件(実際: ${errorDiagnostics.length}件${errorDiagnostics.length ? ': ' + JSON.stringify(errorDiagnostics[0]) : ''})`);
    assert(dataset.schema_version === 'knowledge-data/0.1', 'schema_versionが正しい');
  }

  // ---- node_type中立性・producer/locator形状 ----
  assert(r3.nodes.filter(n => n.node_type !== 'document' && n.node_type !== 'section').every(n => n.node_type === 'statement'),
    '内容Nodeのnode_typeは常にstatement(文書の役割によらない)');
  assert(r3.nodes.every(n => n.provenance.producer === 'pdf'), '全Nodeのprovenance.producerは"pdf"');
  assert(r3.nodes.every(n => n.provenance.locator.kind === 'pdf'), '全Nodeのprovenance.locator.kindは"pdf"');
  assert(stmts3.every(n => typeof n.provenance.locator.section_id === 'string' && typeof n.provenance.locator.block_id === 'string'),
    'statement Nodeのlocatorにsection_id/block_idが保持される');

  // ---- 安全上限の値そのものの確認(採用値の一元管理) ----
  assert(Adapter.MAX_PAGES === 2000 && Adapter.MAX_TEXT_ITEMS === 2000000 &&
    Adapter.MAX_EXTRACTED_CHARS === 5000000 && Adapter.MAX_STATEMENTS === 50000,
    `安全上限の定数が期待どおり(実際: MAX_PAGES=${Adapter.MAX_PAGES}, MAX_TEXT_ITEMS=${Adapter.MAX_TEXT_ITEMS}, MAX_EXTRACTED_CHARS=${Adapter.MAX_EXTRACTED_CHARS}, MAX_STATEMENTS=${Adapter.MAX_STATEMENTS})`);

  // ---- MAX_STATEMENTS上限超過のfail-closedを実際に発火させて確認 ----
  // 数百MB級のPDFを生成しなくても、segmentPdfContent()は素のlayoutオブジェクトを受け取る
  // 純関数なので、MAX_STATEMENTS+1件のページ(各1行)を持つ合成layoutを直接構成して境界値を
  // 正確に検証できる(実PDF生成が非現実的なMAX_PAGES/MAX_TEXT_ITEMS/MAX_EXTRACTED_CHARSは
  // 既知制約として報告に明記する)。
  {
    const bigPages = [];
    for (let i = 0; i < Adapter.MAX_STATEMENTS + 1; i++) {
      bigPages.push([{ text: `段落${i}`, rawText: `段落${i}`, segs: [`段落${i}`], hasMultiSegment: false, page: i + 1, pageIndex: i, bbox: [0.1, 0.1, 0.2, 0.12] }]);
    }
    const bigLayout = { pages: bigPages, numPages: bigPages.length, totalChars: 100, perPageCharCounts: bigPages.map(() => 10), warnings: [] };
    let overflowThrew = false, overflowErr = null;
    try { Adapter.segmentPdfContent(bigLayout); } catch (e) { overflowThrew = true; overflowErr = e; }
    assert(overflowThrew && overflowErr.code === 'statement_count_limit_exceeded',
      `生成予定statement数がMAX_STATEMENTS(${Adapter.MAX_STATEMENTS})を超えるとfail-closedする(実際: threw=${overflowThrew}, code=${overflowErr && overflowErr.code})`);

    const okPages = bigPages.slice(0, Adapter.MAX_STATEMENTS);
    const okLayout = { pages: okPages, numPages: okPages.length, totalChars: 100, perPageCharCounts: okPages.map(() => 10), warnings: [] };
    let okThrew = false;
    try { Adapter.segmentPdfContent(okLayout); } catch (e) { okThrew = true; }
    assert(!okThrew, `MAX_STATEMENTSちょうど(${Adapter.MAX_STATEMENTS}件)は許容される(上限超過にならない)`);
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });

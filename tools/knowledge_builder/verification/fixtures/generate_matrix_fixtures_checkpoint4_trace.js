#!/usr/bin/env node
/* Generates the Trace JSON matrix fixtures used by knowledge_builder_input_matrix_checkpoint4.js
 * (Alpha 0.2.0 Checkpoint 4). matrix_doc_a_trace.json / matrix_doc_b_trace.json follow the
 * existing chapter-section-trace-v1 shape (see samples/hvac_trace_sample_small/JSON_A_*.json)
 * and carry pdf-style records (source_raw_text present) so trace_json_adapter.js's
 * detectProducer() resolves producer:'pdf' for these, distinguishing this Trace-JSON-origin
 * path from the PDF-direct-input path exercised by matrix_doc_a.pdf/matrix_doc_b.pdf.
 * trace_title/trace_text/tags are set directly (the adapter uses these verbatim, no derivation)
 * so trace_text matches the "項目: X / 内容: Y / 区分: Z" string also produced by the Excel
 * fixture's deriveText() and written verbatim into the PDF fixture - see
 * checkpoint4_matrix_expected.json for the shared source of truth these 3 generators mirror.
 * Re-run this script to regenerate the fixtures deterministically if content changes.
 * Run: node tools/knowledge_builder/verification/fixtures/generate_matrix_fixtures_checkpoint4_trace.js
 */
'use strict';
const path = require('path');
const fs = require('fs');

// 是正: DOC_A/DOC_B の内容はcheckpoint4_matrix_expected.jsonの正本と一致させる
// (このスクリプトと他2形式のgenerator、expected manifestの4箇所で値を重複定義している。
// 内容を変更する場合は4箇所すべてを揃えて更新すること)。
const DOC_A_ROWS = [
  { item: '表面温度', content: '通常運転時の表面温度は60度以下とする', category: '温度管理' },
  { item: '動作音', content: '通常運転時の動作音は45dB以下とする', category: '静音性' },
  { item: '設置環境', content: '屋内の乾燥した場所に設置することを前提とする', category: '設置条件' }
];
const DOC_B_ROWS = [
  { item: '筐体表面温度', content: '通常運転時の筐体表面温度を60度以下に維持する設計とする', category: '温度管理' },
  { item: '運転音', content: '通常運転時の運転音を45dB以下に抑える設計とする', category: '静音性' },
  { item: '設置場所', content: '屋内の乾燥した場所への設置を前提とした構造とする', category: '設置条件' }
];

function compositeText(r) { return `項目: ${r.item} / 内容: ${r.content} / 区分: ${r.category}`; }

function buildTraceJson(fileName, rows, idPrefix) {
  const records = rows.map((r, i) => {
    const text = compositeText(r);
    return {
      trace_id: `${idPrefix}-${i + 1}`,
      parent_id: 'sec-matrix-1',
      trace_title: r.item,
      trace_text: text,
      trace_content: [text],
      trace_category: 'text',
      trace_key_text: `${r.item} ${r.content} ${r.category}`,
      chapter_number: '第1章',
      chapter_title: 'マトリクス評価',
      section_number: '1.1',
      section_title: 'マトリクス項目',
      block_type: 'text',
      source_file: fileName,
      source_page: 1,
      source_path: `$.sections[0].content[${i}]`,
      source_kind: 'section_text',
      source_section_id: 'sec-matrix-1',
      source_section_title: 'マトリクス項目',
      source_block_id: `block-matrix-${i + 1}`,
      source_raw_text: text,
      review_status: 'reviewed',
      tags: [],
      unregistered_tags: []
    };
  });
  return {
    file_name: fileName,
    trace_format: 'chapter-section-trace-v1',
    schema_version: '1.1',
    chapter_number: '第1章',
    chapter_title: 'マトリクス評価',
    source: { document_number: null, revision: null, issue_date: null },
    tag_policy: { mode: 'controlled', vocabulary_id: 'trace-domain-ja', tag_vocabulary_version: '1.0.0', allowed_tags: ['安全', '性能', '機能', '品質', 'インターフェース', '製造', '検査', '保守'] },
    _trace_records: records
  };
}

function main() {
  const outDir = __dirname;
  fs.writeFileSync(path.join(outDir, 'matrix_doc_a_trace.json'), JSON.stringify(buildTraceJson('matrix_doc_a_trace.json', DOC_A_ROWS, 'matrix-a'), null, 2));
  fs.writeFileSync(path.join(outDir, 'matrix_doc_b_trace.json'), JSON.stringify(buildTraceJson('matrix_doc_b_trace.json', DOC_B_ROWS, 'matrix-b'), null, 2));
  console.log('Generated: matrix_doc_a_trace.json, matrix_doc_b_trace.json');
}

main();

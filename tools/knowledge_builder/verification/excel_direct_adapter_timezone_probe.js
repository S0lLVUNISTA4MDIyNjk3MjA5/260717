#!/usr/bin/env node
/* Excel Direct Adapter Timezone Determinism Remediation - Checkpoint 2.
 *
 * Single-timezone probe, meant to be spawned as a child process with a specific TZ env var by
 * excel_direct_adapter_timezone_determinism_verification.js (never invoked directly as a test
 * itself). Runs the full excel_direct_adapter.js pipeline against one of the date fixtures under
 * whatever TZ the parent process set, and prints one JSON line to stdout with every value the
 * parent needs to compare across timezones. Kept separate from the fixtures used by the original
 * excel_direct_adapter_verification.js so that timezone-determinism coverage does not depend on
 * modifying that file or its existing assertions.
 *
 * Usage: node excel_direct_adapter_timezone_probe.js <mode>
 *   mode: 'basic' | 'datetime' | 'blank_display' | 'blank_display_repeated'
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Adapter = require('../core/excel_direct_adapter.js');
const RuleExtraction = require('../core/private_dictionary_rule_extraction_core.js');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const TAG_VOCAB = { allowed_tags: ['安全', '性能', '機能', '品質', 'インターフェース', '製造', '検査', '保守'], aliases: {} };

function readAsArrayBuffer(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const MODE = process.argv[2];

const MODES = {
  basic: {
    file: 'excel_direct_fixture_date.xlsx', sheet: '日付あり', headerRow: 1, dataStartRow: 2,
    dateHeader: '納期', fileName: 'excel_direct_fixture_date.xlsx', contentDigest: 'd'.repeat(64),
  },
  datetime: {
    file: 'excel_direct_fixture_datetime.xlsx', sheet: '日時あり', headerRow: 1, dataStartRow: 2,
    dateHeader: '納期時刻', fileName: 'excel_direct_fixture_datetime.xlsx', contentDigest: 'a'.repeat(64),
  },
  blank_display: {
    file: 'excel_direct_fixture_date_blank_display.xlsx', sheet: '日付表示なし', headerRow: 1, dataStartRow: 2,
    dateHeader: '納期', fileName: 'excel_direct_fixture_date_blank_display.xlsx', contentDigest: 'b'.repeat(64),
  },
  // Two rows sharing the same blank-display date value, so TERM_REPEATED_VALUE candidacy's
  // ">=2 distinct row occurrences" gate is actually reached and a real term candidate IS produced
  // from the date VALUE (unlike 'blank_display' above, which is single-row and never produces one).
  blank_display_repeated: {
    file: 'excel_direct_fixture_date_blank_display_repeated.xlsx', sheet: '日付表示なし繰返', headerRow: 1, dataStartRow: 2,
    dateHeader: '納期', fileName: 'excel_direct_fixture_date_blank_display_repeated.xlsx', contentDigest: 'c'.repeat(64),
  },
};

(async () => {
  const cfg = MODES[MODE];
  if (!cfg) { console.error('unknown mode: ' + MODE); process.exit(2); }

  const ab = readAsArrayBuffer(path.join(FIXTURES_DIR, cfg.file));
  const { workbook } = Adapter.inspectWorkbook(ab);
  const extraction = Adapter.extractSheetRows(workbook, cfg.sheet, cfg.headerRow, cfg.dataStartRow);
  const result = await Adapter.buildKnowledgeNodesFromExcel(extraction, {
    fileName: cfg.fileName, contentDigest: cfg.contentDigest,
    ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB,
  });
  const node = result.nodes.find(n => n.node_type === 'statement');
  const roundTripped = JSON.parse(JSON.stringify(node));

  const out = {
    tz: process.env.TZ || null,
    resolvedTz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    rawIso: roundTripped.provenance.verbatim.source_record[cfg.dateHeader],
    display: node.provenance.verbatim.source_record_display[cfg.dateHeader],
    text: node.text,
    title: node.title,
    sourceDocumentId: result.sourceDocument.source_document_id,
    nodeId: node.node_id,
    knowledgeHash: node.revision.knowledge_hash,
  };

  // P2-A2 projection: the VALUE unit's normalized_text for the date column (Checkpoint 1 §5
  // conditional-risk item, Checkpoint 2 §7 / Checkpoint 2.1). Only meaningful when the raw value
  // can end up used (blank_display* modes); computed unconditionally for all modes for a full
  // before/after picture. out.p2a2ValueNormalizedText reflects the FIRST matching row (there is
  // only one row in every mode except blank_display_repeated, where both rows share the same
  // value by construction, so "first" is representative there too).
  const projection = await RuleExtraction.buildExtractionInputProjectionFromExcelAdapterResult(result);
  // KEY/VALUE units for the same column are pushed as a pair with consecutive occurrence_ordinal
  // values (KEY first, then VALUE - see buildExtractionInputProjectionFromExcelAdapterResult()),
  // so the reliable way to find "the VALUE unit paired with a given 納期 KEY unit" is by ordinal
  // adjacency, not by shared parent_source_unit_id (every KEY/VALUE pair in the same row shares
  // the same ROW_RECORD parent, so that alone does not disambiguate columns). A fixture can have
  // more than one row (blank_display_repeated), so this collects every KEY/VALUE pair for the
  // date column across all rows, not just the first.
  const dateKeyUnits = projection.units.filter(u => u.structural_role === 'KEY' && u.normalized_text === cfg.dateHeader);
  const dateValueUnits = dateKeyUnits.map(k => projection.units.find(u => u.structural_role === 'VALUE'
    && u.parent_source_unit_id === k.parent_source_unit_id && u.occurrence_ordinal === k.occurrence_ordinal + 1)).filter(Boolean);
  out.p2a2ValueNormalizedText = dateValueUnits.length > 0 ? dateValueUnits[0].normalized_text : null;

  // Checkpoint 2.1: measure the ACTUAL candidate/candidate_id impact rather than inferring it
  // from normalized_text alone. Run the real extractLocalDictionaryCandidates() pipeline and
  // check whether any produced term candidate OR alias candidate has an evidence_ref pointing at
  // ANY of the date column's VALUE units. If none does, candidate-ID impact is genuinely N/A for
  // this fixture (report that explicitly, do not claim invariance/fix for something never produced).
  out.candidateForDateValue = null; // { kind: 'term'|'alias', candidate_id, canonical_term|alias_term }
  if (dateValueUnits.length > 0) {
    const evaluation = await RuleExtraction.extractLocalDictionaryCandidates([projection]);
    const dateValueUnitIds = new Set(dateValueUnits.map(u => u.source_unit_id));
    const termHit = evaluation.candidates.find(c =>
      c.evidence_refs.some(ev => dateValueUnitIds.has(ev.source_unit_id)));
    if (termHit) {
      out.candidateForDateValue = { kind: 'term', candidate_id: termHit.candidate_id, canonical_term: termHit.canonical_term };
    } else {
      const aliasHit = evaluation.alias_candidates.find(a =>
        a.evidence_refs.some(ev => dateValueUnitIds.has(ev.source_unit_id)));
      if (aliasHit) {
        out.candidateForDateValue = {
          kind: 'alias', alias_candidate_id: aliasHit.alias_candidate_id,
          canonical_candidate_id: aliasHit.canonical_candidate_id, alias_term: aliasHit.alias_term,
        };
      }
    }
  }

  process.stdout.write(JSON.stringify(out) + '\n');
})().catch(e => { console.error('PROBE_FATAL', e); process.exit(1); });

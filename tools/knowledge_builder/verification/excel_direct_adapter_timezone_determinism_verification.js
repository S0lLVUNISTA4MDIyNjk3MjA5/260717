#!/usr/bin/env node
/* Excel Direct Adapter Timezone Determinism Remediation - Checkpoint 2 permanent regression.
 *
 * Confirms that excel_direct_adapter.js produces byte-identical results for the same .xlsx
 * bytes regardless of the host process's timezone. Each timezone runs the full adapter
 * pipeline (inspectWorkbook -> extractSheetRows -> buildKnowledgeNodesFromExcel) in its own,
 * separate Node child process (spawned via excel_direct_adapter_timezone_probe.js with TZ set
 * in that child's environment), because V8's Date/Intl engine caches the host timezone at
 * startup and mutating process.env.TZ in-process is not a reliable way to change it afterward.
 *
 * Required zones (per remediation instruction): UTC, Asia/Tokyo, Asia/Shanghai,
 * America/New_York, plus Asia/Kolkata - a second historical non-integer-minute LMT-offset
 * zone (India: LMT +5:21 vs modern +5:30, a ~9min residual under the old, unfixed code path;
 * see Checkpoint 1's root-cause report), confirmed in Checkpoint 1 to reproduce the same
 * defect class as Asia/Shanghai (LMT +8:05:43 vs modern +8:00) before this fix, and therefore
 * kept here as permanent coverage rather than only Asia/Shanghai.
 *
 * Run: node tools/knowledge_builder/verification/excel_direct_adapter_timezone_determinism_verification.js
 */
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

const PROBE = path.join(__dirname, 'excel_direct_adapter_timezone_probe.js');
const ZONES = ['UTC', 'Asia/Tokyo', 'Asia/Shanghai', 'America/New_York', 'Asia/Kolkata'];

let failures = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else console.log(`PASS: ${message}`);
}

function runProbe(mode, tz) {
  const out = execFileSync(process.execPath, [PROBE, mode], {
    env: Object.assign({}, process.env, { TZ: tz }),
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').pop());
}

function collectAcrossZones(mode) {
  const results = {};
  for (const zone of ZONES) results[zone] = runProbe(mode, zone);
  return results;
}

function allEqual(results, field) {
  const values = ZONES.map(z => results[z][field]);
  return values.every(v => v === values[0]);
}

(function main() {
  // --- mode 'basic': existing excel_direct_fixture_date.xlsx (date-only, visible display). ---
  // This is the exact fixture/scenario the original Codex-reported defect used
  // (2026-08-01T23:59:17.000Z under Asia/Shanghai instead of 2026-08-02T00:00:00.000Z).
  {
    const r = collectAcrossZones('basic');
    console.log('--- basic (date-only) per-zone rawIso ---');
    for (const z of ZONES) console.log(`  ${z}: ${r[z].rawIso}`);
    assert(allEqual(r, 'rawIso'), 'basic: rawIso identical across all 5 timezones');
    assert(r.UTC.rawIso === '2026-08-02T00:00:00.000Z', 'basic: rawIso matches expected value (2026-08-02T00:00:00.000Z), not the pre-fix defective one');
    assert(allEqual(r, 'display'), 'basic: display unchanged across timezones');
    assert(allEqual(r, 'text'), 'basic: Node.text unchanged across timezones');
    assert(allEqual(r, 'title'), 'basic: Node.title unchanged across timezones');
    assert(allEqual(r, 'sourceDocumentId'), 'basic: source_document_id unchanged across timezones');
    assert(allEqual(r, 'nodeId'), 'basic: node_id unchanged across timezones');
    assert(allEqual(r, 'knowledgeHash'), 'basic: knowledge_hash unchanged across timezones');
    assert(allEqual(r, 'p2a2ValueNormalizedText'), 'basic: P2-A2 VALUE unit normalized_text unchanged across timezones');
  }

  // --- mode 'datetime': new fixture with a non-midnight, sub-second (500ms) date+time value. ---
  {
    const r = collectAcrossZones('datetime');
    console.log('--- datetime (date+time, sub-second) per-zone rawIso ---');
    for (const z of ZONES) console.log(`  ${z}: ${r[z].rawIso}`);
    assert(allEqual(r, 'rawIso'), 'datetime: rawIso identical across all 5 timezones');
    assert(r.UTC.rawIso === '2026-08-02T12:34:56.500Z', 'datetime: rawIso preserves sub-second precision and matches expected value');
    assert(allEqual(r, 'display'), 'datetime: display unchanged across timezones');
    assert(allEqual(r, 'text'), 'datetime: Node.text unchanged across timezones');
    assert(allEqual(r, 'title'), 'datetime: Node.title unchanged across timezones');
    assert(allEqual(r, 'sourceDocumentId'), 'datetime: source_document_id unchanged across timezones');
    assert(allEqual(r, 'nodeId'), 'datetime: node_id unchanged across timezones');
    assert(allEqual(r, 'knowledgeHash'), 'datetime: knowledge_hash unchanged across timezones');
    assert(allEqual(r, 'p2a2ValueNormalizedText'), 'datetime: P2-A2 VALUE unit normalized_text unchanged across timezones');
  }

  // --- mode 'blank_display': date-formatted cell whose positive-value display is blank ---
  // (format ';yyyy/mm/dd;;'), while the raw Excel serial is still present and
  // XLSX.SSF.is_date() recognizes it as a date. This is the Checkpoint 1 Sec.5 / Checkpoint 2
  // item 7 "conditional P2-A2 risk", closed in Checkpoint 2.1.
  //
  // Checkpoint 2 fixed excel_direct_adapter.js's cellTextValue() (String(Date) -> toISOString()),
  // closing the gap for provenance.verbatim.source_record, display, Node.text, Node.title,
  // source_document_id, node_id and knowledge_hash - all asserted invariant below.
  //
  // Checkpoint 2 left a separate residual open: private_dictionary_rule_extraction_core.js's
  // safeNormalizeUnitText() independently called String(raw) on the same Date object via its own
  // code path, so the P2-A2 VALUE unit's normalized_text was still timezone-variant. Measuring
  // the ACTUAL candidate/candidate_id impact (not inferring it from normalized_text alone) showed
  // this was not merely cosmetic: the timezone-variant string (e.g.
  // "Sun Aug 02 2026 00:00:00 GMT+0000 (Coordinated Universal Time)") was spuriously matched by
  // the ALIAS_EXPLICIT_PARENTHETICAL rule (a token immediately before "(...)" is treated as a
  // candidate term with the parenthetical as its alias), producing a real term candidate whose
  // canonical_term/candidate_id genuinely differed by timezone (canonical_term "GMT+0000" under
  // UTC vs "GMT+0900" under Asia/Tokyo vs "GMT+0800" under Asia/Shanghai, each a distinct
  // candidate_id) - confirmed by running the actual extractLocalDictionaryCandidates() pipeline,
  // not by inspecting normalized_text alone.
  //
  // Checkpoint 2.1 fixed safeNormalizeUnitText() to use toISOString() for Date raw values (same
  // technique as the Checkpoint 2 excel_direct_adapter.js fix, applied at P2-A2's own
  // normalization choke point; no candidate ID namespace/hash algorithm/extraction rule/threshold/
  // term-alias-rule/provenance-structure change). After the fix, the VALUE unit's normalized_text
  // is the plain ISO string (no parentheses), which no longer matches
  // ALIAS_EXPLICIT_PARENTHETICAL and also still fails TERM_REPEATED_VALUE's >=2-row-occurrence
  // gate (this fixture has only one data row) - so for this fixture, NO candidate or alias
  // candidate is produced from the date VALUE at all, in any timezone. The assertions below
  // verify that directly against the real candidate-evaluation output (candidateForDateValue),
  // not merely against normalized_text, and report N/A rather than a false "fixed" claim if no
  // candidate happens to be produced.
  {
    const r = collectAcrossZones('blank_display');
    console.log('--- blank_display (blank positive display, date raw value) per-zone rawIso / p2a2 / candidate ---');
    for (const z of ZONES) console.log(`  ${z}: rawIso=${r[z].rawIso} text=${JSON.stringify(r[z].text)} p2a2=${JSON.stringify(r[z].p2a2ValueNormalizedText)} candidateForDateValue=${JSON.stringify(r[z].candidateForDateValue)}`);
    assert(allEqual(r, 'rawIso'), 'blank_display: rawIso (provenance.verbatim.source_record) unchanged across timezones');
    assert(r.UTC.rawIso === '2026-08-02T00:00:00.000Z', 'blank_display: rawIso matches expected value');
    assert(r.UTC.display === '', 'blank_display: display is blank as constructed by the fixture (positive format section empty)');
    assert(allEqual(r, 'display'), 'blank_display: display (blank) unchanged across timezones');
    assert(allEqual(r, 'text'), 'blank_display: Node.text unchanged across timezones (Checkpoint 2: cellTextValue() Date fallback uses toISOString())');
    assert(allEqual(r, 'title'), 'blank_display: Node.title unchanged across timezones');
    assert(allEqual(r, 'sourceDocumentId'), 'blank_display: source_document_id unchanged across timezones');
    assert(allEqual(r, 'nodeId'), 'blank_display: node_id unchanged across timezones');
    assert(allEqual(r, 'knowledgeHash'), 'blank_display: knowledge_hash unchanged across timezones');
    assert(allEqual(r, 'p2a2ValueNormalizedText'), 'blank_display: P2-A2 VALUE unit normalized_text unchanged across timezones (Checkpoint 2.1: safeNormalizeUnitText() Date fallback uses toISOString())');
    assert(r.UTC.p2a2ValueNormalizedText === '2026-08-02T00:00:00.000Z', 'blank_display: P2-A2 VALUE unit normalized_text matches the canonical ISO representation (no host-timezone string leaked in)');
    // Measured (not inferred) candidate-ID impact: with only one data row in this fixture,
    // TERM_REPEATED_VALUE never reaches candidacy (needs >=2 distinct row occurrences) and the
    // fixed ISO-string normalized_text no longer matches ALIAS_EXPLICIT_PARENTHETICAL, so no
    // candidate/alias candidate is produced from this VALUE in any timezone. This is the
    // measured ground truth; report it as N/A rather than asserting a false "fixed" candidate_id
    // invariance for something that was never produced in the first place.
    assert(r.UTC.candidateForDateValue === null, 'blank_display: candidate-ID impact is NOT APPLICABLE for this fixture (no term/alias candidate is produced from the date VALUE - single-row fixture never reaches TERM_REPEATED_VALUE candidacy, and the fixed ISO string no longer spuriously matches ALIAS_EXPLICIT_PARENTHETICAL)');
    assert(allEqual(r, 'candidateForDateValue'), 'blank_display: candidateForDateValue (null/N-A) identical across all 5 timezones');
  }

  // --- mode 'blank_display_repeated': same blank-display date cell repeated across 2 rows, so ---
  // TERM_REPEATED_VALUE candidacy's ">=2 distinct row occurrences" gate IS reached and a real term
  // candidate IS produced from the date VALUE (unlike 'blank_display' above, which never produces
  // one at all). This exercises the "an actual candidate is produced" branch of Checkpoint 2.1
  // item 6: the candidate set and candidate_id must be identical across timezones after the fix,
  // not merely absent.
  {
    const r = collectAcrossZones('blank_display_repeated');
    console.log('--- blank_display_repeated (2 rows, same date value) per-zone candidateForDateValue ---');
    for (const z of ZONES) console.log(`  ${z}: p2a2=${JSON.stringify(r[z].p2a2ValueNormalizedText)} candidateForDateValue=${JSON.stringify(r[z].candidateForDateValue)}`);
    assert(allEqual(r, 'rawIso'), 'blank_display_repeated: rawIso unchanged across timezones');
    assert(allEqual(r, 'text'), 'blank_display_repeated: Node.text unchanged across timezones');
    assert(allEqual(r, 'knowledgeHash'), 'blank_display_repeated: knowledge_hash unchanged across timezones');
    assert(allEqual(r, 'p2a2ValueNormalizedText'), 'blank_display_repeated: P2-A2 VALUE unit normalized_text unchanged across timezones');
    assert(r.UTC.candidateForDateValue !== null && r.UTC.candidateForDateValue.kind === 'term',
      'blank_display_repeated: a real term candidate IS produced from the date VALUE (confirms the positive case, not just N/A)');
    assert(r.UTC.candidateForDateValue && r.UTC.candidateForDateValue.canonical_term === '2026-08-02T00:00:00.000Z',
      'blank_display_repeated: candidate canonical_term is the canonical ISO representation (no host-timezone string)');
    assert(ZONES.every(z => JSON.stringify(r[z].candidateForDateValue) === JSON.stringify(r.UTC.candidateForDateValue)),
      'blank_display_repeated: candidate set/candidate_id identical across all 5 timezones');
  }

  console.log(failures === 0 ? '\nALL TIMEZONE DETERMINISM CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();

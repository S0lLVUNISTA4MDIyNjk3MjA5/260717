#!/usr/bin/env node
'use strict';
/* P2-A3 sample verification.
 *
 * Checks three things:
 *   1. determinism  - regenerating into two independent empty directories produces
 *                     byte-identical files, and those match the committed samples
 *   2. manifest     - the committed samples match MANIFEST.sha256
 *   3. expectations - sample_expectations.json still matches a fresh measurement of the
 *                     fixed P2-A2 core
 *
 * Temporary regeneration happens outside the repository (os.tmpdir), and the temp tree is
 * removed afterwards, so verification never leaves generated files in version control.
 *
 * Usage: node verify_samples.js
 * Exit code 0 on success, non-zero on any failure.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const MANIFEST = path.join(HERE, 'MANIFEST.sha256');
const SAMPLE_FILES = [
  'standard/train_hvac_requirement_spec_sample.pdf',
  'standard/train_hvac_design_review_sample.xlsx',
  'edge_cases/alias_conflict_sample.pdf',
  'edge_cases/newline_boundary_sample.pdf',
  'edge_cases/multi_sheet_sample.xlsx',
];

let failures = 0;
let passes = 0;
function assert(cond, message) {
  if (cond) { passes++; console.log(`PASS: ${message}`); }
  else { failures++; console.error(`FAIL: ${message}`); }
}

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function generateInto(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const py = spawnSync('python3', [path.join(HERE, 'generate_train_hvac_pdf_samples.py'), dir], { encoding: 'utf8' });
  if (py.status !== 0) throw new Error('PDF generator failed: ' + (py.stderr || '').slice(0, 200));
  const js = spawnSync(process.execPath, [path.join(HERE, 'generate_train_hvac_excel_samples.js'), dir], { encoding: 'utf8' });
  if (js.status !== 0) throw new Error('XLSX generator failed: ' + (js.stderr || '').slice(0, 200));
}

function main() {
  // ---- 1. determinism -----------------------------------------------------------------------
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'p2a3-sample-verify-'));
  const runA = path.join(tmpRoot, 'a');
  const runB = path.join(tmpRoot, 'b');
  try {
    generateInto(runA);
    generateInto(runB);
    for (const rel of SAMPLE_FILES) {
      const a = sha256(path.join(runA, rel));
      const b = sha256(path.join(runB, rel));
      assert(a === b, `determinism: two independent runs produce identical ${rel}`);
      const committed = sha256(path.join(HERE, rel));
      assert(a === committed, `determinism: regenerated ${rel} matches the committed file`);
    }
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  // ---- 2. manifest --------------------------------------------------------------------------
  if (!fs.existsSync(MANIFEST)) {
    assert(false, 'MANIFEST.sha256 exists');
  } else {
    const entries = fs.readFileSync(MANIFEST, 'utf8').split('\n').filter(Boolean).map(line => {
      const m = line.match(/^([0-9a-f]{64})\s+(.+)$/);
      return m ? { hash: m[1], file: m[2] } : null;
    });
    assert(entries.every(Boolean), 'MANIFEST.sha256 is well formed');
    const listed = new Set(entries.filter(Boolean).map(e => e.file));
    for (const rel of SAMPLE_FILES) assert(listed.has(rel), `MANIFEST lists ${rel}`);
    for (const e of entries.filter(Boolean)) {
      const abs = path.join(HERE, e.file);
      assert(fs.existsSync(abs) && sha256(abs) === e.hash, `MANIFEST hash matches ${e.file}`);
    }
  }

  // ---- 3. expectations ----------------------------------------------------------------------
  const check = spawnSync(process.execPath, [path.join(HERE, 'generate_sample_expectations.js'), '--check'], { encoding: 'utf8' });
  assert(check.status === 0, 'sample_expectations.json matches a fresh measurement of the fixed core');

  console.log(`\n${passes} PASS / ${failures} FAIL`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

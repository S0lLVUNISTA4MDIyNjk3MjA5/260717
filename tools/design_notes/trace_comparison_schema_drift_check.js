// trace_comparison_schema_v2.json($defs.analysis/quantityRecord/intervalBound/evidenceItem/ruleset_version)が
// quantity_annotation_schema_v1.json($defs.analysis/quantityRecord/intervalBound/evidenceItem、および
// ruleset_versionはtop-level properties.ruleset_version)の複製として構造的に乖離していないかを検査する。
// json_schema_minivalidator.js(依存ゼロ原則)がサポートするキーワードのみをrc2 Schemaが使っている
// ことも同じファイルで検査する(未対応キーワードを書いても検証器が黙ってスルーし、実装していない
// 検証をしているつもりになる事故を防ぐため)。
'use strict';
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail }); }

function readJson(file) { return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8')); }

const rc1 = readJson('quantity_annotation_schema_v1.json');
const rc2 = readJson('trace_comparison_schema_v2.json');

// ══════════════ 1. quantityRecord/intervalBound/evidenceItemはbyte-for-byte(構造的に)同一 ══════════════
for (const defName of ['quantityRecord', 'intervalBound', 'evidenceItem']) {
  check(`rc2の$defs.${defName}はrc1の$defs.${defName}と構造的に同一`,
    isDeepStrictEqual(rc1.$defs[defName], rc2.$defs[defName]),
    { rc1: rc1.$defs[defName], rc2: rc2.$defs[defName] });
}

// ══════════════ 2. ruleset_versionは同一(rc1はtop-level properties、rc2は$defs) ══════════════
check('rc2の$defs.ruleset_versionはrc1のproperties.ruleset_versionと構造的に同一',
  isDeepStrictEqual(rc1.properties.ruleset_version, rc2.$defs.ruleset_version),
  { rc1: rc1.properties.ruleset_version, rc2: rc2.$defs.ruleset_version });

// ══════════════ 3. analysisはcontent_hash必須フィールドの追加だけが許された差分 ══════════════
{
  const rc2AnalysisStripped = JSON.parse(JSON.stringify(rc2.$defs.analysis));
  check('rc2の$defs.analysis.requiredにcontent_hashが含まれる', rc2AnalysisStripped.required.includes('content_hash'));
  check('rc2の$defs.analysis.propertiesにcontent_hashが含まれる', 'content_hash' in rc2AnalysisStripped.properties);
  rc2AnalysisStripped.required = rc2AnalysisStripped.required.filter(f => f !== 'content_hash');
  delete rc2AnalysisStripped.properties.content_hash;
  check('content_hash除去後、rc2の$defs.analysisはrc1の$defs.analysisと構造的に同一',
    isDeepStrictEqual(rc1.$defs.analysis, rc2AnalysisStripped),
    { rc1: rc1.$defs.analysis, rc2Stripped: rc2AnalysisStripped });
}

// ══════════════ 4. 未対応Schemaキーワード検出(json_schema_minivalidator.jsが実装するキーワードのみ許可) ══════════════
// $schema/$id/title/descriptionはドキュメント直下でのみ現れメタ情報のため許可対象へ含める
// (validateNode()自体はこれらを一切参照しないが、Schemaドキュメントとして自然に存在してよい)。
const ALLOWED_KEYWORDS = new Set([
  '$schema', '$id', 'title', 'description', 'type', 'const', 'enum', 'pattern',
  'minLength', 'minimum', 'maximum', 'required', 'properties', 'additionalProperties',
  'items', 'oneOf', '$ref', '$defs',
]);

function walkSchemaNode(node, nodePath, errors) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    errors.push(`${nodePath}: スキーマノードがオブジェクトではありません`);
    return;
  }
  for (const key of Object.keys(node)) {
    if (!ALLOWED_KEYWORDS.has(key)) {
      errors.push(`${nodePath}.${key}: 未対応キーワード(json_schema_minivalidator.jsが実装しない)`);
      continue;
    }
    const value = node[key];
    if (key === 'properties') {
      // 子キーはフィールド名であり、Schemaキーワードではない(許可リスト照合の対象外)。
      for (const [propName, propSchema] of Object.entries(value)) walkSchemaNode(propSchema, `${nodePath}.properties.${propName}`, errors);
    } else if (key === '$defs') {
      // 子キーはdef名であり、Schemaキーワードではない(許可リスト照合の対象外)。
      for (const [defName, defSchema] of Object.entries(value)) walkSchemaNode(defSchema, `${nodePath}.$defs.${defName}`, errors);
    } else if (key === 'items') {
      walkSchemaNode(value, `${nodePath}.items`, errors);
    } else if (key === 'oneOf') {
      value.forEach((sub, i) => walkSchemaNode(sub, `${nodePath}.oneOf[${i}]`, errors));
    }
    // required/enum: 配列の要素はフィールド名・許可値であり、Schemaキーワードではないため再帰しない。
    // $ref/const/type/pattern/minLength/minimum/maximum/additionalProperties/description/title/$schema/$id: leaf。
  }
}

{
  const errors = [];
  walkSchemaNode(rc2, '$', errors);
  check('rc2 Schema全体がjson_schema_minivalidator.jsの対応キーワードのみを使う(未対応キーワード0件)', errors.length === 0, errors);
}

// ══════════════ 5. 許可リスト自体の検査が機能していることを確認(意図的な未対応キーワード注入で検出できるか) ══════════════
{
  const errors = [];
  walkSchemaNode({ type: 'object', minItems: 1, properties: { x: { type: 'string' } } }, '$', errors);
  check('未対応キーワード(minItems)注入を検出できる(検査自体の健全性確認)',
    errors.length === 1 && errors[0].includes('minItems'), errors);
}
{
  const errors = [];
  walkSchemaNode({ type: 'object', properties: { minItems: { type: 'string' } } }, '$', errors);
  check('properties配下のフィールド名(たまたまキーワードと同名でも)は誤検出しない', errors.length === 0, errors);
}

console.log('\n=== trace_comparison_schema_drift_check 結果 ===');
let failed = 0;
checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail).slice(0, 2000)); } });
console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
process.exit(failed ? 1 : 0);

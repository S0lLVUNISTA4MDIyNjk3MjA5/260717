// 依存ライブラリなしの最小JSON Schema検証器。
// quantity_annotation_schema_v1.json / trace_comparison_schema_v1.md 系のスキーマが実際に
// 使うキーワードのみをサポートする、汎用実装ではない限定的な検証器(ajv等は本プロジェクトの
// 「依存ゼロ」原則によりnpm経由で導入できないため、必要な部分だけを自前で実装する)。
// サポートするキーワード: type(文字列または配列、nullable表現用), const, enum, pattern,
// minLength, minimum, maximum, required, properties, additionalProperties, items,
// oneOf(判別可能な共用体の表現用。分岐が互いに排他である前提の簡易実装で、JSON Schema仕様の
// 「ちょうど1つに一致」ではなく「1つ以上に一致すればよい」という緩い判定にしている。
// quantity-annotation側は分岐をkindフィールドのconstで判別可能に設計しているため実用上問題ない)、
// $ref(同一ドキュメント内の#/...のみ)。
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (root) root.JsonSchemaMinivalidator = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
'use strict';

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`未対応の$ref(同一ドキュメント内のみ対応): ${ref}`);
  const path = ref.slice(2).split('/');
  let node = root;
  for (const seg of path) {
    node = node[seg];
    if (node === undefined) throw new Error(`$refの解決に失敗しました: ${ref}`);
  }
  return node;
}

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value; // 'number' | 'string' | 'boolean' | 'object'
}

function typeMatches(expected, value) {
  const actual = typeOf(value);
  const matchesOne = (exp) => exp === 'number' ? (actual === 'number' || actual === 'integer') : actual === exp;
  if (Array.isArray(expected)) return expected.some(matchesOne);
  return matchesOne(expected);
}

// errors: 検出したエラーメッセージ(path付き)を蓄積する配列
function validateNode(schema, value, path, root, errors) {
  if (schema.$ref) {
    validateNode(resolveRef(root, schema.$ref), value, path, root, errors);
    return;
  }
  if (schema.oneOf) {
    const branchErrors = schema.oneOf.map(sub => { const e = []; validateNode(sub, value, path, root, e); return e; });
    if (!branchErrors.some(e => e.length === 0)) {
      errors.push(`${path}: oneOfのいずれの分岐にも一致しない (各分岐のエラー: ${JSON.stringify(branchErrors)})`);
    }
    return;
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: const不一致 (期待値=${JSON.stringify(schema.const)}, 実際=${JSON.stringify(value)})`);
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${path}: enum不一致 (期待値のいずれか=${JSON.stringify(schema.enum)}, 実際=${JSON.stringify(value)})`);
  }
  if (schema.type !== undefined && !typeMatches(schema.type, value)) {
    errors.push(`${path}: type不一致 (期待値=${schema.type}, 実際=${typeOf(value)})`);
    return; // 型が違えば以降の詳細検証は意味がないため打ち切る
  }
  if (typeof value === 'string') {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: pattern不一致 (/${schema.pattern}/, 実際=${JSON.stringify(value)})`);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: minLength未満 (期待値>=${schema.minLength}, 実際=${value.length})`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: minimum未満 (期待値>=${schema.minimum}, 実際=${value})`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: maximum超過 (期待値<=${schema.maximum}, 実際=${value})`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => validateNode(schema.items, item, `${path}[${i}]`, root, errors));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    // 【レビュー修正、重大1】`key in value`はプロトタイプ継承チェーンも辿るため、
    // own propertyを持たずプロトタイプ経由でのみ必須フィールドを「持つ」オブジェクト
    // (例: Object.create(validRecordSet))を誤って合格させていた。JSON.stringify()は
    // own enumerable propertyしかシリアライズしないため、検証合格したオブジェクトと
    // 実際に保存されるJSONの内容が一致しない致命的な乖離があった。hasOwnPropertyへ変更する。
    for (const key of (schema.required || [])) {
      if (!hasOwn(value, key)) errors.push(`${path}: 必須フィールド不足: ${key}`);
    }
    if (schema.properties) {
      for (const [key, subSchema] of Object.entries(schema.properties)) {
        if (hasOwn(value, key)) validateNode(subSchema, value[key], `${path}.${key}`, root, errors);
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      // 【レビュー修正、重大1】`key in schema.properties`はschema.properties自身のプロトタイプ
      // 継承チェーン(通常のオブジェクトリテラルなのでObject.prototype)も辿るため、
      // constructor/toString/valueOf/hasOwnProperty/__proto__等の予約名はSchemaで未定義でも
      // "定義済み"と誤判定され、additionalProperties:falseの拒否をすり抜けていた
      // (これらの名前を持つ余分なフィールドが実際に文書へ保存されうる)。hasOwnPropertyへ変更する。
      for (const key of Object.keys(value)) {
        if (!hasOwn(schema.properties, key)) errors.push(`${path}: 未定義フィールド(additionalProperties:false): ${key}`);
      }
    }
  }
}

function validate(schema, value) {
  const errors = [];
  validateNode(schema, value, '$', schema, errors);
  return { valid: errors.length === 0, errors };
}

return { validate };
});

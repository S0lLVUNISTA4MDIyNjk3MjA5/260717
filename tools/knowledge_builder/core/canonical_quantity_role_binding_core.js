/* canonical-quantity-role-binding/0.1-L3-2-CP1
 * Browser/Node shared. L3-2 Checkpoint 1 (Quantity Canonical Role Binding Contract + Pure Core).
 *
 * See tools/knowledge_builder/design/canonical_quantity_role_binding_contract_0.1.md for the full
 * contract. Summary: this module answers exactly one question - "which field(s) on this record does
 * the L3-1 canonical field registry believe are structurally a property/value/unit/relation_condition?"
 * It is a structural HINT producer, never a Quantity semantic authority: it has no concept
 * dictionary, no unit registry, no numeric parser, no comparison logic, and cannot produce a
 * dimension, a resolved concept, a comparison mode, or a satisfied/not_satisfied verdict. The
 * existing quantity_sidecar_binding_core.js remains the sole authority for all of that, unchanged
 * and unwired to this module this checkpoint.
 *
 * This module deliberately does NOT use canonical_matching_field_registry_core.js's own
 * buildCanonicalProjection() - that function keeps only the FIRST field it finds for a given role
 * (`if (!roles[cls.role]) roles[cls.role] = {...}`, verified by direct source read), which is
 * exactly the "adopt the first of several same-role fields" behavior this checkpoint's own
 * requirements forbid. This module calls the lower-level, non-collapsing classifyField() directly,
 * once per field, and performs its own ambiguity-aware aggregation instead.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CanonicalQuantityRoleBinding = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONTRACT_VERSION = 'canonical-quantity-role-binding/0.1-L3-2-CP1';
  const DEFAULT_IDENTITY_FIELD = 'trace_id';
  const DEFAULT_CANDIDATE_LIMIT = 8;

  function defaultRegistry() {
    if (typeof globalThis !== 'undefined' && globalThis.CanonicalMatchingFieldRegistry) {
      return globalThis.CanonicalMatchingFieldRegistry;
    }
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      return require('../../canonical_matching_field_registry_core.js');
    }
    throw new Error('CanonicalMatchingFieldRegistryを読み込めません。canonical_matching_field_registry_core.jsをHTMLと同じフォルダへ配置するか、先にrequireしてください。');
  }

  // Target roles this module cares about (checkpoint task). Any other role - including null/
  // UNCLASSIFIED - is simply out of scope for this module, not an error.
  function targetRoles(registry) {
    return Object.freeze([registry.ROLE.PROPERTY, registry.ROLE.VALUE, registry.ROLE.UNIT, registry.ROLE.RELATION_CONDITION]);
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function isScalarValue(value) {
    return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
  }

  // Defensive validation of classifyField()'s OWN return shape - a future accidental breaking
  // change to the registry must never silently propagate bad data through this module or crash it;
  // it must be caught here and reported as a per-field diagnostic instead.
  function validateClassifyFieldResult(result, registry) {
    if (!isPlainObject(result)) return false;
    if (!isNonEmptyString(result.classification)) return false;
    if (!Object.values(registry.CLASSIFICATION).includes(result.classification)) return false;
    if (result.role !== null && result.role !== undefined) {
      if (typeof result.role !== 'string') return false;
      if (!Object.values(registry.ROLE).includes(result.role)) return false;
    }
    return true;
  }

  function safeClassifyField(registry, schemaKind, fieldName) {
    try {
      return { ok: true, result: registry.classifyField(schemaKind, fieldName) };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  }

  // Deep-equal on plain JSON-shaped values only (records here are always JSON-shaped source data) -
  // used only to distinguish "duplicate_identity" (identical content) from
  // "conflicting_field_binding" (same identity, different content) among excluded records.
  function deepEqualJson(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return false;
    if (typeof a !== 'object') return false;
    const aKeys = Object.keys(a).sort();
    const bKeys = Object.keys(b).sort();
    if (aKeys.length !== bKeys.length) return false;
    for (let i = 0; i < aKeys.length; i++) {
      if (aKeys[i] !== bKeys[i]) return false;
      if (!deepEqualJson(a[aKeys[i]], b[bKeys[i]])) return false;
    }
    return true;
  }

  function compareStrings(a, b) {
    const sa = String(a == null ? '' : a);
    const sb = String(b == null ? '' : b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  }

  function buildCanonicalQuantityRoleHints(options) {
    const opts = options || {};
    const registry = opts.registry || defaultRegistry();
    const identityField = isNonEmptyString(opts.identityField) ? opts.identityField : DEFAULT_IDENTITY_FIELD;
    const candidateLimit = Number.isSafeInteger(opts.candidateLimit) && opts.candidateLimit >= 1
      ? opts.candidateLimit : DEFAULT_CANDIDATE_LIMIT;
    const side = opts.side;
    const records = opts.records;

    if (!Array.isArray(records)) {
      return Object.freeze({
        contract_version: CONTRACT_VERSION, schema_kind: opts.schemaKind || null, side: side ?? null,
        ready: false, hints: Object.freeze([]), excluded: Object.freeze([]),
        diagnostics: Object.freeze([{ code: 'records_not_array', detail: 'records must be an array' }]),
      });
    }

    const schemaKind = isNonEmptyString(opts.schemaKind) ? opts.schemaKind : registry.detectRowsSchemaKind(records);
    const roles = targetRoles(registry);
    const diagnostics = [];
    const excluded = [];

    // ── Identity gate: one pass to find the identity for every record (never mutating records),
    // and to detect duplicates without ever silently keeping "the first" (checkpoint requirement).
    const byIdentity = new Map(); // identity -> array of { record, index }
    records.forEach((record, index) => {
      if (!isPlainObject(record)) {
        excluded.push({ identity: null, reason_code: 'malformed_record', detail: `records[${index}] is not a plain object` });
        return;
      }
      const identity = record[identityField];
      if (!isNonEmptyString(identity)) {
        excluded.push({ identity: null, reason_code: 'missing_identity', detail: `records[${index}].${identityField} is missing or not a non-empty string` });
        return;
      }
      if (!byIdentity.has(identity)) byIdentity.set(identity, []);
      byIdentity.get(identity).push({ record, index });
    });

    const usableRecords = []; // { record, identity }
    byIdentity.forEach((entries, identity) => {
      if (entries.length === 1) {
        usableRecords.push({ record: entries[0].record, identity });
        return;
      }
      // Duplicate identity: never adopt any one of them. Distinguish identical-content duplicates
      // from genuinely conflicting field sets under the same identity - both are excluded either way.
      const allEqual = entries.every((e, i) => i === 0 || deepEqualJson(e.record, entries[0].record));
      const reasonCode = allEqual ? 'duplicate_identity' : 'conflicting_field_binding';
      entries.forEach(e => {
        excluded.push({ identity, reason_code: reasonCode, detail: `identity "${identity}" appears ${entries.length} times in this batch (records[${e.index}])` });
      });
    });

    // ── Per-record, per-field classification. O(records x fields); no cross-record comparison here
    // beyond the identity-uniqueness pass above, and no second `records` array is ever consulted -
    // this module never performs or is capable of an A x B cross product.
    const hints = [];
    usableRecords.forEach(({ record, identity }) => {
      const byRole = new Map(roles.map(r => [r, []]));
      Object.keys(record).forEach(fieldName => {
        if (fieldName.startsWith('_')) return;
        const classified = safeClassifyField(registry, schemaKind, fieldName);
        if (!classified.ok) {
          excluded.push({ identity, reason_code: 'malformed_classification', detail: `classifyField threw for field "${fieldName}": ${classified.error}` });
          return;
        }
        const result = classified.result;
        if (!validateClassifyFieldResult(result, registry)) {
          excluded.push({ identity, reason_code: 'malformed_classification', detail: `classifyField returned a malformed result for field "${fieldName}"` });
          return;
        }
        if (!result.role || !roles.includes(result.role)) return; // out of scope, not an error
        if (!registry.AUTO_ELIGIBLE_CLASSIFICATIONS.includes(result.classification)) {
          excluded.push({ identity, reason_code: 'metadata_only_field', detail: `field "${fieldName}" has target role "${result.role}" but classification "${result.classification}" is not auto-eligible` });
          return;
        }
        const rawValue = record[fieldName];
        if (!isScalarValue(rawValue)) {
          excluded.push({ identity, reason_code: 'unsupported_complex_field', detail: `field "${fieldName}" has target role "${result.role}" but its value is not a scalar (string/number/boolean/null)` });
          return;
        }
        byRole.get(result.role).push({
          source_field: fieldName,
          raw_value: rawValue,
          classification: result.classification,
          provenance: Object.freeze({ source: result.source || null, note: result.note || '' }),
        });
      });

      byRole.forEach((candidatesForRole, role) => {
        if (!candidatesForRole.length) return;
        candidatesForRole.sort((a, b) => compareStrings(a.source_field, b.source_field));
        const truncated = candidatesForRole.length > candidateLimit;
        const bounded = candidatesForRole.slice(0, candidateLimit).map(c => Object.freeze(c));
        hints.push(Object.freeze({
          side: side ?? null,
          identity,
          canonical_role: role,
          status: bounded.length > 1 ? 'ambiguous' : 'resolved',
          candidates: Object.freeze(bounded),
          truncated,
        }));
      });
    });

    hints.sort((a, b) => compareStrings(a.identity, b.identity) || compareStrings(a.canonical_role, b.canonical_role) || compareStrings(a.candidates[0]?.source_field, b.candidates[0]?.source_field));
    excluded.sort((a, b) => compareStrings(a.identity, b.identity) || compareStrings(a.reason_code, b.reason_code) || compareStrings(a.detail, b.detail));

    return Object.freeze({
      contract_version: CONTRACT_VERSION,
      schema_kind: schemaKind,
      side: side ?? null,
      ready: true,
      hints: Object.freeze(hints),
      excluded: Object.freeze(excluded.map(e => Object.freeze(e))),
      diagnostics: Object.freeze(diagnostics),
    });
  }

  return {
    CONTRACT_VERSION,
    DEFAULT_IDENTITY_FIELD,
    DEFAULT_CANDIDATE_LIMIT,
    buildCanonicalQuantityRoleHints,
  };
});

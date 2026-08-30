/* canonical-quantity-sidecar-context/0.1-L3-2-CP2A
 * Browser/Node shared. L3-2 Checkpoint 2-A (Verified Binding -> Canonical Quantity Context Bridge).
 *
 * See tools/knowledge_builder/design/canonical_quantity_sidecar_context_contract_0.1.md for the
 * full contract. Summary: this module bridges QuantitySidecarBinding.bindInputPair()'s already
 * content-hash/dataset-signature-verified, deep-frozen binding snapshot to
 * CanonicalQuantityRoleBinding.buildCanonicalQuantityRoleHints() (Checkpoint 1.1) - it is
 * STRUCTURAL/PROVENANCE ONLY. It never touches, calls, or influences any Quantity semantic
 * function (generatePropertyCandidates/generatePropertyResolutions/generateDimensionCandidates/
 * generateConditionResolutions/generateUnitConversionPlans/generateNormalizedQuantityViews/
 * generateNumericComparisonResults/generateAutoApplicabilityResults/
 * generateAutomaticJudgementResults - none of them are imported, required, or invoked here).
 *
 * The only permitted data chain (never bypassed): raw Trace/Sidecar -> bindInputPair() -> verified
 * immutable binding snapshot -> THIS module's inspection projection -> buildCanonicalQuantityRoleHints()
 * -> validated canonical quantity context. A caller-supplied hint set is never trusted merely
 * because it has the right shape - validateHintsAgainstBinding() cross-checks every hint against
 * the SAME verified binding and the SAME inspection projection this module itself would have
 * produced, rejecting anything tampered or stale before it can be called "usable".
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CanonicalQuantitySidecarContext = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONTRACT_VERSION = 'canonical-quantity-sidecar-context/0.1-L3-2-CP2A';
  // The Quantity pipeline's own side vocabulary (bindInputPair()'s own parameter/return names) -
  // never sys/plm. This is the integration boundary that commits to that vocabulary; Checkpoint
  // 1.1's own core stays fully side-agnostic.
  const ALLOWED_SIDES = Object.freeze(['requirement', 'actual']);
  const ALLOWED_ROLES = Object.freeze(['property', 'value', 'unit', 'relation_condition']);
  const ALLOWED_STATUSES = Object.freeze(['unique', 'ambiguous']);
  // Reserved projection-identity keys: if source_record contains any of these, the WHOLE record's
  // projection is refused (never silently overridden by spread precedence) - see
  // buildProjectionForRecord()'s collision handling.
  const RESERVED_PROJECTION_KEYS = Object.freeze(['trace_id']);
  // Always used for the ephemeral projection's schemaKind, regardless of the original record's
  // real schema (pdf_trace/excel_trace/generic_trace_like) - see the contract doc for why this is
  // safe: none of the four target roles are ever assigned by either registered schema's own field
  // table (verified by direct source read), only by the schema-agnostic generic business-name-
  // pattern fallback layer, so forcing this value changes nothing about hint outcomes while making
  // ephemeral-projection classification fully deterministic and decoupled from upstream schema
  // quirks.
  const PROJECTION_SCHEMA_KIND = 'generic_trace_like';

  function defaultRoleBindingCore() {
    if (typeof globalThis !== 'undefined' && globalThis.CanonicalQuantityRoleBinding) return globalThis.CanonicalQuantityRoleBinding;
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('./canonical_quantity_role_binding_core.js');
    throw new Error('CanonicalQuantityRoleBindingを読み込めません。canonical_quantity_role_binding_core.jsを先に読み込んでください。');
  }
  function defaultRegistry() {
    if (typeof globalThis !== 'undefined' && globalThis.CanonicalMatchingFieldRegistry) return globalThis.CanonicalMatchingFieldRegistry;
    if (typeof module === 'object' && module.exports && typeof require === 'function') return require('../../canonical_matching_field_registry_core.js');
    throw new Error('CanonicalMatchingFieldRegistryを読み込めません。canonical_matching_field_registry_core.jsを先に読み込んでください。');
  }

  function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function isScalarValue(value) { return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'; }
  function isNonEmptyString(value) { return typeof value === 'string' && value.length > 0; }

  function failClosedContext(code, detail, side) {
    return Object.freeze({
      contract_version: CONTRACT_VERSION, side: side || null, ready: false,
      contexts: Object.freeze([]), excluded: Object.freeze([]),
      diagnostics: Object.freeze([{ code, detail }]),
    });
  }

  // Builds the ephemeral, non-persisted inspection projection for ONE verified-bound trace record.
  // Never mutates `record`; never writes source_record.trace_id into identity (collision fail-
  // closed instead, §6). Only scalar values ever reach the projection (§7) - object/array values
  // are silently dropped here defensively, though buildCanonicalQuantityRoleHints() would also
  // reject them downstream (defense in depth, not the only line of protection).
  function buildProjectionForRecord(record, verifiedTraceId) {
    if (isPlainObject(record?.source_record)) {
      const sr = record.source_record;
      if (RESERVED_PROJECTION_KEYS.some(k => Object.prototype.hasOwnProperty.call(sr, k))) {
        return { projection: null, origin: 'source_record', collision: true };
      }
      const projection = { trace_id: verifiedTraceId };
      Object.keys(sr).forEach(k => { if (isScalarValue(sr[k])) projection[k] = sr[k]; });
      return { projection, origin: 'source_record', collision: false };
    }
    // Generic/PDF top-level path: trace_id is re-asserted from the verified identity (never read
    // back from the record's own top-level trace_id - though for this path they are definitionally
    // the same value, this keeps both projection paths structurally uniform).
    const projection = { trace_id: verifiedTraceId };
    Object.keys(record || {}).forEach(k => {
      if (k === 'trace_id' || k.startsWith('_')) return;
      if (isScalarValue(record[k])) projection[k] = record[k];
    });
    return { projection, origin: 'top_level', collision: false };
  }

  // One side's verified projections, keyed by trace_id. Only 'bound' entries are used - that is
  // the only status where bindSide() actually computed AND verified a content_hash against the
  // sidecar annotation end-to-end (missing/unparsed/stale_annotation records exist in bindings[]
  // too, but their content_hash was never successfully verified against an annotation, so they are
  // not treated as part of the "content-hash / dataset-signature verified immutable binding
  // snapshot" this bridge is built on top of).
  function buildProjectionsForSide(binding, side) {
    const sideBinding = binding && binding[side];
    const projectionsByTraceId = new Map();
    const excluded = [];
    if (!isPlainObject(sideBinding) || sideBinding.ready !== true || !Array.isArray(sideBinding.bindings)) {
      return { projectionsByTraceId, excluded, records: [] };
    }
    const records = [];
    sideBinding.bindings.forEach(entry => {
      if (!isPlainObject(entry) || entry.status !== 'bound' || !isNonEmptyString(entry.trace_id)) return;
      const built = buildProjectionForRecord(entry.record, entry.trace_id);
      if (built.collision) {
        excluded.push({ identity: entry.trace_id, reason_code: 'canonical_projection_collision', detail: `source_record contains a reserved identity key (${RESERVED_PROJECTION_KEYS.join(', ')})` });
        return;
      }
      projectionsByTraceId.set(entry.trace_id, { projection: built.projection, origin: built.origin });
      records.push(built.projection);
    });
    return { projectionsByTraceId, excluded, records };
  }

  // Cross-checks a hint-set RESPONSE (the full object CanonicalQuantityRoleBinding.
  // buildCanonicalQuantityRoleHints() returns - contract_version/side/ready/hints included, never
  // just a bare hints array) against the SAME verified projections this module itself would have
  // produced for `side`. A hint is never trusted merely because it has the right shape - every
  // field is cross-checked against the trusted projection, not merely type-checked.
  function validateHintsAgainstBinding(options) {
    const opts = options || {};
    const roleBindingCore = opts.roleBindingCore || defaultRoleBindingCore();
    const side = opts.side;
    const hintsResponse = opts.hintsResponse;
    const projectionsByTraceId = opts.projectionsByTraceId
      || buildProjectionsForSide(opts.binding, side).projectionsByTraceId;

    if (!isPlainObject(hintsResponse)) {
      return { usable_hints: [], rejected: [{ identity: null, reason_code: 'canonical_hint_invalid', detail: 'hint response is not an object' }] };
    }
    if (hintsResponse.contract_version !== roleBindingCore.CONTRACT_VERSION) {
      return { usable_hints: [], rejected: [{ identity: null, reason_code: 'canonical_hint_contract_mismatch', detail: 'hint response contract_version does not match the expected Checkpoint 1.1 contract' }] };
    }
    if (hintsResponse.side !== side) {
      return { usable_hints: [], rejected: [{ identity: null, reason_code: 'canonical_hint_side_mismatch', detail: 'hint response side does not match the binding side being bridged' }] };
    }
    if (hintsResponse.ready !== true || !Array.isArray(hintsResponse.hints)) {
      return { usable_hints: [], rejected: [{ identity: null, reason_code: 'canonical_hint_invalid', detail: 'hint response is not ready, or hints is not an array' }] };
    }

    const usable = [];
    const rejected = [];
    hintsResponse.hints.forEach(hint => {
      if (!isPlainObject(hint)) { rejected.push({ identity: null, reason_code: 'canonical_hint_invalid', detail: 'a hint entry is not an object' }); return; }
      if (hint.side !== side) { rejected.push({ identity: hint.identity ?? null, reason_code: 'canonical_hint_side_mismatch', detail: 'hint.side does not match the binding side being bridged' }); return; }
      const known = projectionsByTraceId.get(hint.identity);
      if (!known) { rejected.push({ identity: hint.identity ?? null, reason_code: 'canonical_hint_identity_mismatch', detail: 'hint.identity is not a verified bound trace_id for this side' }); return; }
      if (!ALLOWED_ROLES.includes(hint.canonical_role)) { rejected.push({ identity: hint.identity, reason_code: 'canonical_hint_invalid', detail: 'hint.canonical_role is not one of the four allowed roles' }); return; }
      if (!ALLOWED_STATUSES.includes(hint.status)) { rejected.push({ identity: hint.identity, reason_code: 'canonical_hint_invalid', detail: 'hint.status is not unique/ambiguous' }); return; }
      const candidates = Array.isArray(hint.candidates) ? hint.candidates : null;
      if (!candidates || !candidates.length) { rejected.push({ identity: hint.identity, reason_code: 'canonical_hint_invalid', detail: 'hint.candidates is missing or empty' }); return; }
      const badCandidate = candidates.find(c => !isPlainObject(c)
        || !Object.prototype.hasOwnProperty.call(known.projection, c.source_field)
        || known.projection[c.source_field] !== c.raw_value);
      if (badCandidate) {
        rejected.push({ identity: hint.identity, reason_code: 'canonical_hint_value_mismatch', detail: `candidate source_field/raw_value does not match the verified projection for role "${hint.canonical_role}"` });
        return;
      }
      usable.push(hint);
    });
    return { usable_hints: usable, rejected };
  }

  // Main entry point: builds the verified inspection projection for `side`, runs the Checkpoint
  // 1.1 core on it, self-validates the result via validateHintsAgainstBinding() (dogfooding the
  // same defense adversarial callers are checked against), and assembles the bridge output. Never
  // calls, imports, or influences any Quantity semantic function.
  function buildCanonicalQuantityContext(options) {
    const opts = options || {};
    const binding = opts.binding;
    const side = opts.side;
    const roleBindingCore = opts.roleBindingCore || defaultRoleBindingCore();
    const registry = opts.registry || defaultRegistry();

    if (!ALLOWED_SIDES.includes(side)) {
      return failClosedContext('unsupported_side', `side must be exactly "requirement" or "actual" (got ${JSON.stringify(side)})`, null);
    }
    if (!isPlainObject(binding) || !isPlainObject(binding[side])) {
      return failClosedContext('canonical_binding_invalid', 'binding must be a bindInputPair() result containing the requested side', side);
    }

    const { projectionsByTraceId, excluded: projectionExcluded, records } = buildProjectionsForSide(binding, side);

    // Case A (§13): no bound records / nothing classifiable is a completely normal state (e.g. no
    // Snapshot loaded yet) - ready:true, empty context, never a failure.
    if (!records.length) {
      return Object.freeze({
        contract_version: CONTRACT_VERSION, side, ready: true,
        contexts: Object.freeze([]),
        excluded: Object.freeze(projectionExcluded.map(e => Object.freeze(e))),
        diagnostics: Object.freeze([]),
      });
    }

    const hintsResponse = roleBindingCore.buildCanonicalQuantityRoleHints({
      side, records, registry, schemaKind: PROJECTION_SCHEMA_KIND, identityField: 'trace_id',
    });

    const validation = validateHintsAgainstBinding({ side, hintsResponse, projectionsByTraceId, roleBindingCore });

    const contexts = validation.usable_hints.map(hint => Object.freeze({
      side: hint.side,
      trace_id: hint.identity,
      canonical_role: hint.canonical_role,
      status: hint.status,
      candidates: Object.freeze(hint.candidates.map(c => Object.freeze({
        source_field: c.source_field,
        raw_value: c.raw_value,
        classification: c.classification,
        provenance: c.provenance,
        projection_origin: projectionsByTraceId.get(hint.identity).origin,
      }))),
      usable: true,
    }));

    return Object.freeze({
      contract_version: CONTRACT_VERSION,
      side,
      ready: true,
      contexts: Object.freeze(contexts),
      excluded: Object.freeze([...projectionExcluded, ...hintsResponse.excluded, ...validation.rejected].map(e => Object.freeze(e))),
      diagnostics: Object.freeze([...hintsResponse.diagnostics]),
    });
  }

  return {
    CONTRACT_VERSION,
    ALLOWED_SIDES,
    ALLOWED_ROLES,
    ALLOWED_STATUSES,
    RESERVED_PROJECTION_KEYS,
    buildProjectionForRecord,
    buildProjectionsForSide,
    validateHintsAgainstBinding,
    buildCanonicalQuantityContext,
  };
});

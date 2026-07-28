'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const toolsDir = path.join(__dirname, '..');
const sessionPath = path.join(toolsDir, 'trace_comparison_review_session_core.js');
const bindingPath = path.join(toolsDir, 'quantity_sidecar_binding_core.js');
const sessionCore = require(sessionPath);
const bindingCore = require(bindingPath);
const stateCore = require(path.join(toolsDir, 'trace_comparison_review_state_core.js'));
const validator = require(path.join(__dirname, 'trace_comparison_record_set_validator.js'));

let passed = 0;
let total = 0;
const tests = [];
function test(name, fn) { tests.push({ name, fn }); total += 1; }
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Reflect.ownKeys(value).forEach(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) deepFreeze(descriptor.value);
    });
    Object.freeze(value);
  }
  return value;
}
function frozenTree(value) {
  if (!value || typeof value !== 'object') return;
  assert(Object.isFrozen(value));
  Reflect.ownKeys(value).forEach(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')) frozenTree(descriptor.value);
  });
}
const hex = char => char.repeat(64);
const reqSig = `QA-SHA256:${hex('a')}`;
const actSig = `QA-SHA256:${hex('b')}`;
const at = '2026-07-23T03:04:05.678Z';
function relationship(overrides = {}) {
  return {
    source:'matching_engine', match_method:'tag', match_confidence:0.88,
    review_category:'review', linked_at:null, ...overrides
  };
}
function relation(label = '1', overrides = {}) {
  return {
    requirement_trace_id:`req-${label}`, actual_trace_id:`act-${label}`,
    matcher_a_id:`A-${label}`, matcher_b_id:`B-${label}`,
    relationship:relationship(), ...overrides
  };
}
function bindingStub(overrides = {}) {
  return deepFreeze({
    schema_version:'quantity-binding/phase-b1', ready:true,
    requirement:{ ready:true, dataset_signature:reqSig },
    actual:{ ready:true, dataset_signature:actSig },
    diagnostics:[], not_analyzed:[], comparison_candidates:[],
    satisfaction_judgements:[], ...overrides
  });
}
function recordSetStub(generatedAt = at, matchingSignature = 'matching-1', ids = ['cmp-v1:test']) {
  return {
    schema_version:'trace-comparison/1.0-rc2', generated_at:generatedAt,
    provenance:{ requirement_dataset_signature:reqSig, actual_dataset_signature:actSig },
    display_context:{ matching_dataset_signature:matchingSignature },
    comparisons:ids.map(comparison_id => ({
      comparison_id,
      automatic_judgement:{ satisfied:true },
      review:{ untouched:true }
    }))
  };
}
function sourceContext(overrides = {}) {
  return {
    active_matching_job:null, input_stale:false, matching_stale:false,
    matching_run_id:1, matching_generation:1,
    requirement_dataset_signature:reqSig, actual_dataset_signature:actSig,
    matching_dataset_signature:'matching-1', relations:[relation()], ...overrides
  };
}
function startInput(captureSourceContext) {
  return {
    captureSourceContext, generatedAt:at,
    generator:{ tool:'verification', version:'1' },
    sessionId:'session-1', startedAt:at, startedBy:'reviewer'
  };
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function installRealmClone(context) {
  vm.runInNewContext(`
    globalThis.structuredClone = function clone(value) {
      if (value === null || typeof value !== 'object') return value;
      if (Array.isArray(value)) return value.map(clone);
      const result = {};
      Reflect.ownKeys(value).forEach(key => { result[key] = clone(value[key]); });
      return result;
    };
  `, context);
}
function browserSessionApi(quantitySidecarBinding = bindingCore) {
  const context = {
    QuantitySidecarBinding:quantitySidecarBinding,
    TraceComparisonReviewStateCore:stateCore,
    TraceComparisonRecordSetValidator:validator,
    console
  };
  context.globalThis = context;
  installRealmClone(context);
  vm.runInNewContext(fs.readFileSync(sessionPath, 'utf8'), context, { filename:sessionPath });
  return context.TraceComparisonReviewSessionCore;
}
function sessionApiWithBinding(quantitySidecarBinding) {
  const bindingId = require.resolve(bindingPath);
  const sessionId = require.resolve(sessionPath);
  const bindingModule = require.cache[bindingId];
  const sessionModule = require.cache[sessionId];
  const originalBindingExports = bindingModule.exports;
  bindingModule.exports = quantitySidecarBinding;
  delete require.cache[sessionId];
  try {
    return require(sessionId);
  } finally {
    bindingModule.exports = originalBindingExports;
    require.cache[sessionId] = sessionModule;
  }
}
function harness(overrides = {}) {
  const calls = { bind:0, producer:0, validator:0, producerArgs:null, validatorInput:null };
  const binding = overrides.binding || bindingStub();
  const recordSet = overrides.recordSet || recordSetStub();
  const q = {
    ...bindingCore,
    bindInputPair:overrides.bindInputPair || (() => {
      calls.bind += 1;
      return Promise.resolve(binding);
    }),
    generateTraceComparisonRecordSet:overrides.producer || (args => {
      calls.producer += 1;
      calls.producerArgs = args;
      return { ready:true, result_complete:true, diagnostics:[], record_set:recordSet };
    }),
    rawSha256Utf8:overrides.rawSha256Utf8 || bindingCore.rawSha256Utf8,
    hashParts:overrides.hashParts || bindingCore.hashParts,
    canonicalJson:overrides.canonicalJson || bindingCore.canonicalJson
  };
  const v = {
    validateTraceComparisonRecordSet:overrides.validate || (snapshot => {
      calls.validator += 1;
      calls.validatorInput = snapshot;
      if (overrides.mutateInValidator) {
        try { snapshot.generated_at = 'changed'; } catch (_) {}
      }
      return { valid:true, schema_errors:[], semantic_errors:[] };
    })
  };
  const coordinator = sessionCore.createReviewSessionCoordinator({
    quantitySidecarBinding:q,
    reviewStateCore:overrides.reviewStateCore || stateCore,
    recordSetValidator:v
  });
  return { coordinator, calls, q, binding, recordSet };
}
async function readyHarness(overrides = {}) {
  const h = harness(overrides);
  const begun = h.coordinator.beginBindingRefresh({ reasonCode:'input_changed', occurredAt:at });
  assert(begun.ok);
  const completed = await h.coordinator.completeBindingRefresh({
    token:begun.value, requirementTrace:{}, requirementAnnotation:{},
    actualTrace:{}, actualAnnotation:{}
  });
  assert(completed.ok, JSON.stringify(completed));
  return h;
}
async function startReady(h, context = sourceContext()) {
  const result = await h.coordinator.startReviewSession(startInput(() => context));
  return result;
}
function clone(value) { return structuredClone(value); }
function makeHidden(object, key = 'hidden') {
  Object.defineProperty(object, key, { value:true, enumerable:false });
  return object;
}
function makeAccessor(object, key, counter) {
  const value = object[key];
  Object.defineProperty(object, key, {
    enumerable:true, configurable:true,
    get() { counter.count += 1; return value; }
  });
  return object;
}
function acceptAction(target = 'quantity_extraction', overrides = {}) {
  return { type:'accept_review_target', comparison_id:'cmp-v1:test', target,
    reviewer:'reviewer', reviewed_at:at, verdict:'accept', note:null, ...overrides };
}
function transitionInput(action, captureSourceContext = () => sourceContext()) {
  return { action, captureSourceContext, occurredAt:at };
}

test('CommonJS API and constants', () => {
  assert.strictEqual(typeof sessionCore.createReviewSessionCoordinator, 'function');
  assert.strictEqual(sessionCore.LIVE_SOURCE_MARKER_PREFIX, 'b4-live-source-v1:');
});
test('API object is frozen', () => assert(Object.isFrozen(sessionCore)));
test('coordinator API is frozen', () => assert(Object.isFrozen(harness().coordinator)));
test('browser global API', () => {
  const context = {
    QuantitySidecarBinding:bindingCore,
    TraceComparisonReviewStateCore:stateCore,
    TraceComparisonRecordSetValidator:validator,
    console
  };
  context.globalThis = context;
  installRealmClone(context);
  vm.runInNewContext(fs.readFileSync(sessionPath, 'utf8'), context, { filename:sessionPath });
  assert.strictEqual(typeof context.TraceComparisonReviewSessionCore.computeSnapshotIdentity, 'function');
  assert(Object.isFrozen(context.TraceComparisonReviewSessionCore));
});
test('rawSha256Utf8 is additive export of existing sha256 implementation', () => {
  const source = fs.readFileSync(bindingPath, 'utf8');
  assert(source.includes('rawSha256Utf8:sha256'));
  assert.strictEqual(typeof bindingCore.rawSha256Utf8, 'function');
});
test('session core contains no independent crypto implementation', () => {
  const source = fs.readFileSync(sessionPath, 'utf8');
  assert(!source.includes("require('crypto')"));
  assert(!source.includes('crypto.subtle'));
});
test('session core uses shared canonicalJson without an independent serializer', () => {
  const source = fs.readFileSync(sessionPath, 'utf8');
  assert(!source.includes('JSON.stringify'));
  assert(source.includes('bindingApi.canonicalJson(bindingRef)'));
  assert(source.includes('bindingApi.canonicalJson(exactRecordSetSnapshot)'));
});
test('canonical integer-index vector', async () => {
  const text = bindingCore.canonicalJson({ '10':'a', '2':'b' });
  assert.strictEqual(text, '{"2":"b","10":"a"}');
  assert.strictEqual(await bindingCore.rawSha256Utf8(text),
    'b6e3a5de6007a9d717e70a63d7a5925fbad17a4c8b911a64354b0adf21956d06');
});
test('raw digest preserves whitespace and normalization differences', async () => {
  const values = ['a  b', 'a b', 'Ａ', 'A', ' x', 'x'];
  const hashes = await Promise.all(values.map(bindingCore.rawSha256Utf8));
  assert.strictEqual(new Set(hashes).size, values.length);
});

test('relation order produces same canonical JSON and digest', async () => {
  const a = await sessionCore.prepareRelationSnapshot([relation('2'), relation('1')]);
  const b = await sessionCore.prepareRelationSnapshot([relation('1'), relation('2')]);
  assert(a.ok && b.ok);
  assert.strictEqual(a.value.canonicalJsonText, b.value.canonicalJsonText);
  assert.strictEqual(a.value.relationSnapshotDigest, b.value.relationSnapshotDigest);
});
test('relation digest is raw SHA-256 of canonical relation JSON', async () => {
  const result = await sessionCore.prepareRelationSnapshot([relation()]);
  assert(result.ok);
  assert.strictEqual(result.value.relationSnapshotDigest,
    `SHA-256:${await bindingCore.rawSha256Utf8(result.value.canonicalJsonText)}`);
});
test('relation metadata preserves whitespace and changes identity', async () => {
  const plain = await sessionCore.prepareRelationSnapshot([relation()]);
  const spacedMethod = relation();
  spacedMethod.relationship.match_method = ' tag ';
  const spacedCategory = relation();
  spacedCategory.relationship.review_category = ' review ';
  const method = await sessionCore.prepareRelationSnapshot([spacedMethod]);
  const category = await sessionCore.prepareRelationSnapshot([spacedCategory]);
  assert(plain.ok && method.ok && category.ok);
  assert.strictEqual(method.value.sortedRelations[0].relationship.match_method, ' tag ');
  assert.strictEqual(category.value.sortedRelations[0].relationship.review_category, ' review ');
  assert.notStrictEqual(plain.value.canonicalJsonText, method.value.canonicalJsonText);
  assert.notStrictEqual(plain.value.relationSnapshotDigest, method.value.relationSnapshotDigest);
  assert.notStrictEqual(plain.value.relationSnapshotDigest, category.value.relationSnapshotDigest);
});
test('relation preparation does not mutate input and freezes output', async () => {
  const input = [relation()];
  const before = JSON.stringify(input);
  const result = await sessionCore.prepareRelationSnapshot(input);
  assert(result.ok);
  assert.strictEqual(JSON.stringify(input), before);
  frozenTree(result.value);
});
test('manual relation normal form accepted', async () => {
  const item = relation('m', { relationship:relationship({
    source:'manual', match_method:null, match_confidence:null,
    review_category:null, linked_at:at
  }) });
  assert((await sessionCore.prepareRelationSnapshot([item])).ok);
});
test('relation rejects hidden property', async () => {
  assert(!(await sessionCore.prepareRelationSnapshot([makeHidden(relation())])).ok);
});
test('relation rejects symbol property', async () => {
  const item = relation(); item[Symbol('x')] = true;
  assert(!(await sessionCore.prepareRelationSnapshot([item])).ok);
});
test('relation rejects accessor without executing getter', async () => {
  const counter = { count:0 };
  const item = makeAccessor(relation(), 'matcher_a_id', counter);
  assert(!(await sessionCore.prepareRelationSnapshot([item])).ok);
  assert.strictEqual(counter.count, 0);
});
test('relation rejects custom prototype', async () => {
  const item = Object.assign(Object.create({ inherited:true }), relation());
  assert(!(await sessionCore.prepareRelationSnapshot([item])).ok);
});
test('relation rejects sparse array', async () => {
  const items = [relation()]; items.length = 2;
  assert(!(await sessionCore.prepareRelationSnapshot(items)).ok);
});
test('relation rejects confidence outside range', async () => {
  const item = relation(); item.relationship.match_confidence = 2;
  assert(!(await sessionCore.prepareRelationSnapshot([item])).ok);
});
test('relation rejects noncanonical linked_at', async () => {
  const item = relation(); item.relationship.linked_at = '2026-07-23';
  assert(!(await sessionCore.prepareRelationSnapshot([item])).ok);
});

test('binding lifecycle starts at generation zero', () => {
  const c = harness().coordinator;
  assert.strictEqual(c.getBindingGeneration(), 0);
  assert.strictEqual(c.getReviewSourceEpoch(), 0);
});
test('begin increments epoch and generation synchronously and clears runtime', async () => {
  const h = await readyHarness();
  assert(h.coordinator.getBindingRuntime());
  const result = h.coordinator.beginBindingRefresh({ reasonCode:'refresh', occurredAt:at });
  assert(result.ok);
  assert.strictEqual(h.coordinator.getBindingGeneration(), 2);
  assert.strictEqual(h.coordinator.getReviewSourceEpoch(), 2);
  assert.strictEqual(h.coordinator.getBindingRuntime(), null);
});
test('bindInputPair is called once before completeBindingRefresh yields', async () => {
  let calls = 0;
  const wait = deferred();
  const h = harness({ bindInputPair:() => { calls += 1; return wait.promise; } });
  const token = h.coordinator.beginBindingRefresh({ reasonCode:'refresh', occurredAt:at }).value;
  const promise = h.coordinator.completeBindingRefresh({
    token, requirementTrace:{}, requirementAnnotation:{}, actualTrace:{}, actualAnnotation:{}
  });
  assert.strictEqual(calls, 1);
  wait.resolve(bindingStub());
  assert((await promise).ok);
});
test('binding ready false is not published', async () => {
  const h = harness({ binding:bindingStub({ ready:false }) });
  const token = h.coordinator.beginBindingRefresh({ reasonCode:'refresh', occurredAt:at }).value;
  const result = await h.coordinator.completeBindingRefresh({
    token, requirementTrace:{}, requirementAnnotation:{}, actualTrace:{}, actualAnnotation:{}
  });
  assert(!result.ok);
  assert.strictEqual(h.coordinator.getBindingRuntime(), null);
});
test('binding must be recursively frozen', async () => {
  const mutable = clone(bindingStub());
  const h = harness({ binding:mutable });
  const token = h.coordinator.beginBindingRefresh({ reasonCode:'refresh', occurredAt:at }).value;
  const result = await h.coordinator.completeBindingRefresh({
    token, requirementTrace:{}, requirementAnnotation:{}, actualTrace:{}, actualAnnotation:{}
  });
  assert(!result.ok);
});
test('published binding metadata is deep frozen', async () => {
  const h = await readyHarness();
  frozenTree(h.coordinator.getBindingRuntime());
});
test('binding content changes digest and identity', async () => {
  const a = await sessionCore.computeBindingRuntimeMetadata({
    bindingRef:bindingStub(), bindingGeneration:1
  });
  const b = await sessionCore.computeBindingRuntimeMetadata({
    bindingRef:bindingStub({
      requirement:{
        ready:true, dataset_signature:reqSig,
        candidate_records:[{ quantity_id:'sidecar-candidate-difference' }]
      }
    }),
    bindingGeneration:1
  });
  assert(a.ok && b.ok);
  assert.notStrictEqual(a.value.binding_snapshot_digest, b.value.binding_snapshot_digest);
  assert.notStrictEqual(a.value.binding_identity, b.value.binding_identity);
});
test('binding digest and identity use the fixed formulas', async () => {
  const binding = bindingStub();
  const result = await sessionCore.computeBindingRuntimeMetadata({
    bindingRef:binding, bindingGeneration:7
  });
  const digest = `SHA-256:${await bindingCore.rawSha256Utf8(bindingCore.canonicalJson(binding))}`;
  const identity = `b4-binding-v1:${await bindingCore.hashParts(
    'b4-review-binding-identity-v1', ['7', digest]
  )}`;
  assert.strictEqual(result.value.binding_snapshot_digest, digest);
  assert.strictEqual(result.value.binding_identity, identity);
});
test('binding generation changes identity but not digest', async () => {
  const binding = bindingStub();
  const a = await sessionCore.computeBindingRuntimeMetadata({ bindingRef:binding, bindingGeneration:1 });
  const b = await sessionCore.computeBindingRuntimeMetadata({ bindingRef:binding, bindingGeneration:2 });
  assert.strictEqual(a.value.binding_snapshot_digest, b.value.binding_snapshot_digest);
  assert.notStrictEqual(a.value.binding_identity, b.value.binding_identity);
});
test('binding metadata captures generation before raw digest await', async () => {
  const gate = deferred();
  let digestStarted = false;
  const api = sessionApiWithBinding({
    ...bindingCore,
    rawSha256Utf8:async text => {
      digestStarted = true;
      await gate.promise;
      return bindingCore.rawSha256Utf8(text);
    }
  });
  const input = { bindingRef:bindingStub(), bindingGeneration:1 };
  const promise = api.computeBindingRuntimeMetadata(input);
  while (!digestStarted) await Promise.resolve();
  input.bindingGeneration = 2;
  gate.resolve();
  const result = await promise;
  assert(result.ok);
  assert.strictEqual(result.value.binding_generation, 1);
  const expected = `b4-binding-v1:${await bindingCore.hashParts(
    'b4-review-binding-identity-v1',
    ['1', result.value.binding_snapshot_digest]
  )}`;
  assert.strictEqual(result.value.binding_identity, expected);
});
test('old binding completion cannot overwrite new generation', async () => {
  const waits = [deferred(), deferred()];
  let call = 0;
  const h = harness({ bindInputPair:() => waits[call++].promise });
  const first = h.coordinator.beginBindingRefresh({ reasonCode:'first', occurredAt:at }).value;
  const oldPromise = h.coordinator.completeBindingRefresh({
    token:first, requirementTrace:{}, requirementAnnotation:{}, actualTrace:{}, actualAnnotation:{}
  });
  const second = h.coordinator.beginBindingRefresh({ reasonCode:'second', occurredAt:at }).value;
  waits[0].resolve(bindingStub());
  assert(!(await oldPromise).ok);
  assert.strictEqual(h.coordinator.getBindingRuntime(), null);
  const newPromise = h.coordinator.completeBindingRefresh({
    token:second, requirementTrace:{}, requirementAnnotation:{}, actualTrace:{}, actualAnnotation:{}
  });
  waits[1].resolve(bindingStub());
  assert((await newPromise).ok);
  assert.strictEqual(h.coordinator.getBindingRuntime().binding_generation, 2);
});
test('binding refresh token cannot be completed twice', async () => {
  const h = harness();
  const token = h.coordinator.beginBindingRefresh({ reasonCode:'refresh', occurredAt:at }).value;
  const input = { token, requirementTrace:{}, requirementAnnotation:{}, actualTrace:{}, actualAnnotation:{} };
  assert((await h.coordinator.completeBindingRefresh(input)).ok);
  assert(!(await h.coordinator.completeBindingRefresh(input)).ok);
});
test('binding publication rechecks token generation and epoch', () => {
  const source = fs.readFileSync(sessionPath, 'utf8');
  const completeBody = source.slice(
    source.indexOf('async function completeBindingRefresh'),
    source.indexOf('function invalidateReviewSource')
  );
  assert(completeBody.includes('review_source_epoch !== expectedEpoch'));
  assert(completeBody.includes('binding_generation !== expectedGeneration'));
  assert(completeBody.includes('current_binding_refresh_token !== null'));
  assert(completeBody.includes('acceptedToken.binding_generation !== expectedGeneration'));
});
test('safe integer overflow checks are fixed in source', () => {
  const source = fs.readFileSync(sessionPath, 'utf8');
  assert(source.match(/review_source_epoch === Number\.MAX_SAFE_INTEGER/g).length >= 2);
  assert(source.includes('binding_generation === Number.MAX_SAFE_INTEGER'));
  assert(source.includes('review_start_sequence === Number.MAX_SAFE_INTEGER'));
});

test('validator receives the frozen snapshot before validation', async () => {
  const h = await readyHarness({ mutateInValidator:true });
  const result = await startReady(h);
  assert(result.ok);
  assert(Object.isFrozen(h.calls.validatorInput));
  assert.strictEqual(h.calls.validatorInput.generated_at, at);
});
test('validator input and retained record set snapshot are the same reference', async () => {
  const h = await readyHarness();
  const result = await startReady(h);
  assert(result.ok);
  assert.strictEqual(h.calls.validatorInput, h.coordinator.getRecordSetSnapshot());
});
test('normal start calls producer once and publishes separate overlay and snapshot', async () => {
  const h = await readyHarness();
  const result = await startReady(h);
  assert(result.ok);
  assert.strictEqual(h.calls.producer, 1);
  assert.strictEqual(h.calls.validator, 1);
  assert.strictEqual(h.calls.validatorInput, h.coordinator.getRecordSetSnapshot());
  assert.notStrictEqual(h.coordinator.getReviewSession(), h.coordinator.getRecordSetSnapshot());
  assert.strictEqual(h.coordinator.getReviewSession().session_revision, 0);
  assert(!Object.prototype.hasOwnProperty.call(h.coordinator.getRecordSetSnapshot(), 'overlay_version'));
});
test('producer receives captured binding and equivalent captured relation rows', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  assert.strictEqual(h.calls.producerArgs.binding, h.coordinator.getBindingRuntime().binding_ref);
  assert.strictEqual(h.calls.producerArgs.relations[0].requirement_trace_id, 'req-1');
  assert.strictEqual(h.calls.producerArgs.relations[0].source, 'matching_engine');
  frozenTree(h.calls.producerArgs.relations);
});
test('validator receives record_set alone after freeze', async () => {
  const h = await readyHarness({ mutateInValidator:true });
  assert((await startReady(h)).ok);
  assert(Object.isFrozen(h.calls.validatorInput));
  assert.strictEqual(h.calls.validatorInput.generated_at, at);
  assert.strictEqual(h.calls.validatorInput.ready, undefined);
});
test('exact record snapshot is recursively frozen', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  frozenTree(h.coordinator.getRecordSetSnapshot());
});

async function runRace(change) {
  let rawCalls = 0;
  const gate = deferred();
  const h = await readyHarness({
    rawSha256Utf8:async text => {
      rawCalls += 1;
      if (rawCalls === 2) await gate.promise;
      return bindingCore.rawSha256Utf8(text);
    }
  });
  let context = sourceContext();
  const promise = h.coordinator.startReviewSession(startInput(() => context));
  while (rawCalls < 2) await Promise.resolve();
  await change({ h, get:() => context, set:value => { context = value; } });
  gate.resolve();
  const result = await promise;
  assert(!result.ok);
  assert.strictEqual(h.coordinator.getReviewSession(), null);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), null);
  return { result, h };
}
test('start captures request values and generator before callback and digest await', async () => {
  let rawCalls = 0;
  const gate = deferred();
  const h = await readyHarness({
    rawSha256Utf8:async text => {
      rawCalls += 1;
      if (rawCalls === 2) await gate.promise;
      return bindingCore.rawSha256Utf8(text);
    }
  });
  const context = sourceContext();
  let request;
  request = startInput(() => {
    request.generator.tool = 'changed-during-capture';
    return context;
  });
  const promise = h.coordinator.startReviewSession(request);
  while (rawCalls < 2) await Promise.resolve();
  assert.strictEqual(h.calls.producerArgs.generator.tool, 'verification');
  frozenTree(h.calls.producerArgs.generator);
  request.sessionId = 'changed-session';
  request.startedBy = 'changed-reviewer';
  request.generatedAt = '2026-07-23T03:04:06.678Z';
  gate.resolve();
  const result = await promise;
  assert(result.ok, JSON.stringify(result));
  assert.strictEqual(result.value.session_id, 'session-1');
  assert.strictEqual(result.value.started_by, 'reviewer');
  assert.strictEqual(h.coordinator.getRecordSetSnapshot().generated_at, at);
});
test('start uses the same captured source callback for final recapture', async () => {
  let rawCalls = 0;
  const gate = deferred();
  const h = await readyHarness({
    rawSha256Utf8:async text => {
      rawCalls += 1;
      if (rawCalls === 2) await gate.promise;
      return bindingCore.rawSha256Utf8(text);
    }
  });
  let liveContext = sourceContext();
  const request = startInput(() => liveContext);
  const promise = h.coordinator.startReviewSession(request);
  while (rawCalls < 2) await Promise.resolve();
  liveContext = { ...liveContext, matching_generation:2 };
  request.captureSourceContext = () => sourceContext();
  gate.resolve();
  const result = await promise;
  assert(!result.ok);
  assert.strictEqual(result.diagnostics[0].code, 'review_session_stale');
  assert.strictEqual(h.coordinator.getReviewSession(), null);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), null);
});
test('in-flight epoch invalidation prevents publication', async () => {
  const { result } = await runRace(({ h }) => {
    const changed = h.coordinator.invalidateReviewSource({
      reasonCode:'relation_changed', occurredAt:at, affectsBinding:false
    });
    assert(changed.ok);
  });
  assert.strictEqual(result.diagnostics[0].code, 'review_session_stale');
});
test('in-flight binding refresh prevents publication', async () => {
  await runRace(({ h }) => {
    assert(h.coordinator.beginBindingRefresh({ reasonCode:'binding_changed', occurredAt:at }).ok);
  });
});
test('in-flight matching generation change prevents publication', async () => {
  await runRace(({ get, set }) => set({ ...get(), matching_generation:2 }));
});
test('in-flight dataset signature change prevents publication', async () => {
  await runRace(({ get, set }) => set({
    ...get(), requirement_dataset_signature:`QA-SHA256:${hex('c')}`
  }));
});
test('in-flight relation change prevents publication', async () => {
  await runRace(({ get, set }) => set({ ...get(), relations:[relation('changed')] }));
});
test('in-flight active matching job prevents publication', async () => {
  const { result } = await runRace(
    ({ get, set }) => set({ ...get(), active_matching_job:{ id:'job-2' } })
  );
  assert.strictEqual(result.diagnostics[0].code, 'review_session_busy');
});
test('second start while first is in flight is rejected', async () => {
  let rawCalls = 0;
  const gate = deferred();
  const h = await readyHarness({
    rawSha256Utf8:async text => {
      rawCalls += 1;
      if (rawCalls === 2) await gate.promise;
      return bindingCore.rawSha256Utf8(text);
    }
  });
  const context = sourceContext();
  const first = h.coordinator.startReviewSession(startInput(() => context));
  while (rawCalls < 2) await Promise.resolve();
  const second = await h.coordinator.startReviewSession(startInput(() => context));
  assert(!second.ok);
  assert.strictEqual(second.diagnostics[0].code, 'review_session_busy');
  gate.resolve();
  assert((await first).ok);
});
test('source invalidation explicitly invalidates the in-flight start token', () => {
  const source = fs.readFileSync(sessionPath, 'utf8');
  const invalidateBody = source.slice(
    source.indexOf('function invalidateReviewSource'),
    source.indexOf('async function startReviewSession')
  );
  assert(invalidateBody.includes('current_review_start_token = null;'));
});

test('live marker captures source digest and epoch before hash await', async () => {
  const h = await readyHarness();
  const source = sourceContext();
  const relationSnapshot = await sessionCore.prepareRelationSnapshot(source.relations);
  const gate = deferred();
  let hashStarted = false;
  const api = sessionApiWithBinding({
    ...bindingCore,
    hashParts:async (domain, parts) => {
      hashStarted = true;
      await gate.promise;
      return bindingCore.hashParts(domain, parts);
    }
  });
  const input = {
    sourceContext:source,
    bindingRuntime:h.coordinator.getBindingRuntime(),
    relationSnapshotDigest:relationSnapshot.value.relationSnapshotDigest,
    reviewSourceEpoch:1
  };
  const promise = api.computeLiveSourceMarker(input);
  while (!hashStarted) await Promise.resolve();
  source.matching_generation = 99;
  source.matching_dataset_signature = 'matching-2';
  input.relationSnapshotDigest = `SHA-256:${hex('c')}`;
  input.reviewSourceEpoch = 8;
  gate.resolve();
  const result = await promise;
  assert(result.ok);
  assert.strictEqual(result.value.matching_generation, 1);
  assert.strictEqual(result.value.matching_dataset_signature, 'matching-1');
  assert.strictEqual(result.value.relation_snapshot_digest,
    relationSnapshot.value.relationSnapshotDigest);
  assert.strictEqual(result.value.review_source_epoch, 1);
  const expected = `b4-live-source-v1:${await bindingCore.hashParts(
    'b4-review-live-source-marker-v1',
    [
      reqSig, actSig, 'matching-1', '1',
      h.coordinator.getBindingRuntime().binding_identity,
      relationSnapshot.value.relationSnapshotDigest, '1'
    ]
  )}`;
  assert.strictEqual(result.value.value, expected);
});
test('live marker rejects digest from different relations', async () => {
  const h = await readyHarness();
  const relationB = await sessionCore.prepareRelationSnapshot([relation('different')]);
  const result = await sessionCore.computeLiveSourceMarker({
    sourceContext:sourceContext(),
    bindingRuntime:h.coordinator.getBindingRuntime(),
    relationSnapshotDigest:relationB.value.relationSnapshotDigest,
    reviewSourceEpoch:1
  });
  assert(!result.ok);
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_identity_mismatch');
});
test('live marker rejects binding digest and identity forgery', async () => {
  const h = await readyHarness();
  const relationSnapshot = await sessionCore.prepareRelationSnapshot(sourceContext().relations);
  const runtime = h.coordinator.getBindingRuntime();
  for (const forged of [
    deepFreeze({ ...runtime, binding_snapshot_digest:`SHA-256:${hex('1')}` }),
    deepFreeze({ ...runtime, binding_identity:`b4-binding-v1:${hex('2')}` })
  ]) {
    const result = await sessionCore.computeLiveSourceMarker({
      sourceContext:sourceContext(),
      bindingRuntime:forged,
      relationSnapshotDigest:relationSnapshot.value.relationSnapshotDigest,
      reviewSourceEpoch:1
    });
    assert(!result.ok);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_identity_mismatch');
  }
});
test('snapshot identity rejects live marker value forgery after structuredClone', async () => {
  const h = await readyHarness();
  const relationSnapshot = await sessionCore.prepareRelationSnapshot(sourceContext().relations);
  const marker = (await sessionCore.computeLiveSourceMarker({
    sourceContext:sourceContext(),
    bindingRuntime:h.coordinator.getBindingRuntime(),
    relationSnapshotDigest:relationSnapshot.value.relationSnapshotDigest,
    reviewSourceEpoch:1
  })).value;
  const forged = deepFreeze({
    ...structuredClone(marker), value:`b4-live-source-v1:${hex('f')}`
  });
  const result = await sessionCore.computeSnapshotIdentity({
    exactRecordSetSnapshot:deepFreeze(recordSetStub()),
    liveSourceMarker:forged
  });
  assert(!result.ok);
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_identity_mismatch');
});
test('snapshot identity captures live marker before record digest await', async () => {
  const h = await readyHarness();
  const relationSnapshot = await sessionCore.prepareRelationSnapshot(sourceContext().relations);
  const marker = (await sessionCore.computeLiveSourceMarker({
    sourceContext:sourceContext(),
    bindingRuntime:h.coordinator.getBindingRuntime(),
    relationSnapshotDigest:relationSnapshot.value.relationSnapshotDigest,
    reviewSourceEpoch:1
  })).value;
  const mutableMarker = clone(marker);
  const originalValue = mutableMarker.value;
  const gate = deferred();
  let digestStarted = false;
  const api = sessionApiWithBinding({
    ...bindingCore,
    rawSha256Utf8:async text => {
      digestStarted = true;
      await gate.promise;
      return bindingCore.rawSha256Utf8(text);
    }
  });
  const recordSet = deepFreeze(recordSetStub());
  const promise = api.computeSnapshotIdentity({
    exactRecordSetSnapshot:recordSet,
    liveSourceMarker:mutableMarker
  });
  while (!digestStarted) await Promise.resolve();
  mutableMarker.value = `b4-live-source-v1:${hex('c')}`;
  gate.resolve();
  const result = await promise;
  assert(result.ok);
  const expected = `b4-snapshot-v1:${await bindingCore.hashParts(
    'b4-review-snapshot-identity-v1',
    [originalValue, recordSet.schema_version, result.value.record_set_digest]
  )}`;
  assert.strictEqual(result.value.value, expected);
});

test('generated_at is excluded from live marker but included in snapshot identity', async () => {
  const h = await readyHarness();
  const runtime = h.coordinator.getBindingRuntime();
  const relationSnapshot = await sessionCore.prepareRelationSnapshot(sourceContext().relations);
  const source = sourceContext();
  const markerA = await sessionCore.computeLiveSourceMarker({
    sourceContext:source, bindingRuntime:runtime,
    relationSnapshotDigest:relationSnapshot.value.relationSnapshotDigest, reviewSourceEpoch:1
  });
  const markerB = await sessionCore.computeLiveSourceMarker({
    sourceContext:{ ...source }, bindingRuntime:runtime,
    relationSnapshotDigest:relationSnapshot.value.relationSnapshotDigest, reviewSourceEpoch:1
  });
  assert.strictEqual(markerA.value.value, markerB.value.value);
  const a = deepFreeze(recordSetStub(at));
  const b = deepFreeze(recordSetStub('2026-07-23T03:04:06.678Z'));
  const idA = await sessionCore.computeSnapshotIdentity({
    exactRecordSetSnapshot:a, liveSourceMarker:markerA.value
  });
  const idB = await sessionCore.computeSnapshotIdentity({
    exactRecordSetSnapshot:b, liveSourceMarker:markerA.value
  });
  assert.notStrictEqual(idA.value.value, idB.value.value);
});
test('live marker and snapshot identity use the fixed formulas', async () => {
  const h = await readyHarness();
  const runtime = h.coordinator.getBindingRuntime();
  const relationSnapshot = await sessionCore.prepareRelationSnapshot(sourceContext().relations);
  const context = sourceContext();
  const marker = await sessionCore.computeLiveSourceMarker({
    sourceContext:context, bindingRuntime:runtime,
    relationSnapshotDigest:relationSnapshot.value.relationSnapshotDigest,
    reviewSourceEpoch:1
  });
  const expectedMarker = `b4-live-source-v1:${await bindingCore.hashParts(
    'b4-review-live-source-marker-v1',
    [
      context.requirement_dataset_signature, context.actual_dataset_signature,
      context.matching_dataset_signature, String(context.matching_generation),
      runtime.binding_identity, relationSnapshot.value.relationSnapshotDigest, '1'
    ]
  )}`;
  assert.strictEqual(marker.value.value, expectedMarker);
  const recordSet = deepFreeze(recordSetStub());
  const identity = await sessionCore.computeSnapshotIdentity({
    exactRecordSetSnapshot:recordSet, liveSourceMarker:marker.value
  });
  const digest = `SHA-256:${await bindingCore.rawSha256Utf8(
    bindingCore.canonicalJson(recordSet)
  )}`;
  const expectedIdentity = `b4-snapshot-v1:${await bindingCore.hashParts(
    'b4-review-snapshot-identity-v1', [expectedMarker, recordSet.schema_version, digest]
  )}`;
  assert.strictEqual(identity.value.record_set_digest, digest);
  assert.strictEqual(identity.value.value, expectedIdentity);
});
test('Node and browser API compute the same snapshot identity', async () => {
  const context = {
    QuantitySidecarBinding:bindingCore,
    TraceComparisonReviewStateCore:stateCore,
    TraceComparisonRecordSetValidator:validator,
    console
  };
  context.globalThis = context;
  installRealmClone(context);
  vm.runInNewContext(fs.readFileSync(sessionPath, 'utf8'), context, { filename:sessionPath });
  const h = await readyHarness();
  const relationSnapshot = await sessionCore.prepareRelationSnapshot(sourceContext().relations);
  const marker = (await sessionCore.computeLiveSourceMarker({
    sourceContext:sourceContext(), bindingRuntime:h.coordinator.getBindingRuntime(),
    relationSnapshotDigest:relationSnapshot.value.relationSnapshotDigest,
    reviewSourceEpoch:1
  })).value;
  const recordSet = deepFreeze(recordSetStub());
  const nodeResult = await sessionCore.computeSnapshotIdentity({
    exactRecordSetSnapshot:recordSet, liveSourceMarker:marker
  });
  context.identityInputText = JSON.stringify({
    exactRecordSetSnapshot:recordSet, liveSourceMarker:marker
  });
  const browserResult = await vm.runInNewContext(
    `(function() {
      const input = JSON.parse(identityInputText);
      function freeze(value) {
        if (value && typeof value === 'object') {
          Object.values(value).forEach(freeze);
          Object.freeze(value);
        }
        return value;
      }
      freeze(input.exactRecordSetSnapshot);
      freeze(input.liveSourceMarker);
      return TraceComparisonReviewSessionCore.computeSnapshotIdentity(input);
    })()`,
    context
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(browserResult)),
    JSON.parse(JSON.stringify(nodeResult)));
});
test('live marker changes across identity boundaries', async () => {
  const h = await readyHarness();
  const runtime = h.coordinator.getBindingRuntime();
  const relationA = await sessionCore.prepareRelationSnapshot([relation()]);
  const changedRelations = [
    relation('1', { relationship:relationship({ review_category:'changed' }) })
  ];
  const relationB = await sessionCore.prepareRelationSnapshot(changedRelations);
  const base = {
    sourceContext:sourceContext(), bindingRuntime:runtime,
    relationSnapshotDigest:relationA.value.relationSnapshotDigest, reviewSourceEpoch:1
  };
  const values = [];
  values.push((await sessionCore.computeLiveSourceMarker(base)).value.value);
  values.push((await sessionCore.computeLiveSourceMarker({
    ...base,
    sourceContext:{ ...base.sourceContext, relations:changedRelations },
    relationSnapshotDigest:relationB.value.relationSnapshotDigest
  })).value.value);
  values.push((await sessionCore.computeLiveSourceMarker({
    ...base, reviewSourceEpoch:2
  })).value.value);
  values.push((await sessionCore.computeLiveSourceMarker({
    ...base, sourceContext:{ ...base.sourceContext, matching_generation:2 }
  })).value.value);
  assert.strictEqual(new Set(values).size, values.length);
});
test('record set content changes snapshot identity', async () => {
  const h = await readyHarness();
  const rel = await sessionCore.prepareRelationSnapshot(sourceContext().relations);
  const marker = (await sessionCore.computeLiveSourceMarker({
    sourceContext:sourceContext(), bindingRuntime:h.coordinator.getBindingRuntime(),
    relationSnapshotDigest:rel.value.relationSnapshotDigest, reviewSourceEpoch:1
  })).value;
  const a = await sessionCore.computeSnapshotIdentity({
    exactRecordSetSnapshot:deepFreeze(recordSetStub()), liveSourceMarker:marker
  });
  const changed = recordSetStub(); changed.comparisons[0].extra = 'changed';
  const b = await sessionCore.computeSnapshotIdentity({
    exactRecordSetSnapshot:deepFreeze(changed), liveSourceMarker:marker
  });
  assert.notStrictEqual(a.value.value, b.value.value);
});

test('existing active and stale sessions both block restart', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  assert(!(await startReady(h)).ok);
  assert(h.coordinator.invalidateReviewSource({
    reasonCode:'changed', occurredAt:at, affectsBinding:false
  }).ok);
  assert(!(await startReady(h)).ok);
});
test('start fails without binding runtime', async () => {
  const h = harness();
  assert(!(await startReady(h)).ok);
});
test('start rejects display_context null', async () => {
  const rs = recordSetStub(); rs.display_context = null;
  const h = await readyHarness({ recordSet:rs });
  assert(!(await startReady(h)).ok);
});
test('start rejects empty matching signature', async () => {
  const h = await readyHarness();
  assert(!(await startReady(h, sourceContext({ matching_dataset_signature:'' }))).ok);
});
test('source and live marker reject non-string matching dataset signature', async () => {
  for (const matching_dataset_signature of [null, undefined, 1, true]) {
    const h = await readyHarness();
    assert(!(await startReady(h, sourceContext({ matching_dataset_signature }))).ok);
  }
  const runtime = (await sessionCore.computeBindingRuntimeMetadata({
    bindingRef:bindingStub(), bindingGeneration:1
  })).value;
  const relationSnapshot = await sessionCore.prepareRelationSnapshot([relation()]);
  const result = await sessionCore.computeLiveSourceMarker({
    sourceContext:sourceContext({ matching_dataset_signature:null }),
    bindingRuntime:runtime,
    relationSnapshotDigest:relationSnapshot.value.relationSnapshotDigest,
    reviewSourceEpoch:0
  });
  assert(!result.ok);
});
test('generator tool and version must be non-empty trimmed strings', async () => {
  for (const field of ['tool', 'version']) {
    for (const value of [null, undefined, 1, true, '', ' spaced ']) {
      const h = await readyHarness();
      const input = startInput(() => sourceContext());
      input.generator[field] = value;
      assert(!(await h.coordinator.startReviewSession(input)).ok);
    }
  }
});
test('start rejects producer not ready, incomplete, or missing record_set', async () => {
  for (const generated of [
    { ready:false, result_complete:true, record_set:recordSetStub() },
    { ready:true, result_complete:false, record_set:recordSetStub() },
    { ready:true, result_complete:true, record_set:null }
  ]) {
    const h = await readyHarness({ producer:() => generated });
    assert(!(await startReady(h)).ok);
  }
});
test('start converts validator throw and valid false to failure result', async () => {
  const thrown = await readyHarness({ validate:() => { throw new Error('secret stack'); } });
  const bad = await readyHarness({ validate:() => ({ valid:false }) });
  assert(!(await startReady(thrown)).ok);
  assert(!(await startReady(bad)).ok);
});
test('start rejects duplicate and zero comparisons', async () => {
  const duplicate = await readyHarness({ recordSet:recordSetStub(at, 'matching-1', ['cmp-v1:x', 'cmp-v1:x']) });
  const zero = await readyHarness({ recordSet:recordSetStub(at, 'matching-1', []) });
  assert(!(await startReady(duplicate)).ok);
  assert(!(await startReady(zero)).ok);
});
test('start rejects cyclic and nonfinite record sets', async () => {
  const cycle = recordSetStub(); cycle.self = cycle;
  const nonfinite = recordSetStub(); nonfinite.extra = Infinity;
  assert(!(await startReady(await readyHarness({ recordSet:cycle }))).ok);
  assert(!(await startReady(await readyHarness({ recordSet:nonfinite }))).ok);
});
test('start rejects getter, symbol, and hidden properties without executing getter', async () => {
  const counter = { count:0 };
  const getter = makeAccessor(recordSetStub(), 'generated_at', counter);
  const symbol = recordSetStub(); symbol[Symbol('x')] = true;
  const hidden = makeHidden(recordSetStub());
  assert(!(await startReady(await readyHarness({ recordSet:getter }))).ok);
  assert.strictEqual(counter.count, 0);
  assert(!(await startReady(await readyHarness({ recordSet:symbol }))).ok);
  assert(!(await startReady(await readyHarness({ recordSet:hidden }))).ok);
});
test('dependency then accessors are rejected without execution', async () => {
  for (const kind of ['source', 'producer', 'validator']) {
    const counter = { count:0 };
    let context = sourceContext();
    const overrides = {};
    if (kind === 'source') context = makeAccessor(context, 'then', counter);
    if (kind === 'producer') {
      overrides.producer = () => makeAccessor({
        ready:true, result_complete:true, diagnostics:[], record_set:recordSetStub()
      }, 'then', counter);
    }
    if (kind === 'validator') {
      overrides.validate = () => makeAccessor({
        valid:true, schema_errors:[], semantic_errors:[]
      }, 'then', counter);
    }
    const h = await readyHarness(overrides);
    const result = await startReady(h, context);
    assert(!result.ok);
    assert.strictEqual(counter.count, 0);
  }
});
test('inherited then accessors are rejected without execution', async () => {
  for (const kind of ['source', 'producer', 'validator']) {
    const counter = { count:0 };
    const prototype = {};
    Object.defineProperty(prototype, 'then', {
      get() { counter.count += 1; return () => {}; }
    });
    const inherited = value => Object.setPrototypeOf(value, prototype);
    let context = sourceContext();
    const overrides = {};
    if (kind === 'source') context = inherited(context);
    if (kind === 'producer') {
      overrides.producer = () => inherited({
        ready:true, result_complete:true, diagnostics:[], record_set:recordSetStub()
      });
    }
    if (kind === 'validator') {
      overrides.validate = () => inherited({
        valid:true, schema_errors:[], semantic_errors:[]
      });
    }
    const h = await readyHarness(overrides);
    assert(!(await startReady(h, context)).ok);
    assert.strictEqual(counter.count, 0);
  }
});
test('start rejects mutable and frozen malformed Stage 1 sessions', async () => {
  const mutableCore = {
    ...stateCore,
    createInitialReviewSessionState:() => ({
      ok:true, session:{ session_status:'active' }, diagnostics:[]
    })
  };
  const malformedCore = {
    ...stateCore,
    createInitialReviewSessionState:() => deepFreeze({
      ok:true,
      session:{ overlay_version:'b4-review-overlay/1.0-runtime',
        session_status:'active', session_revision:0 },
      diagnostics:[]
    })
  };
  for (const reviewStateCore of [mutableCore, malformedCore]) {
    const h = await readyHarness({ reviewStateCore });
    const result = await startReady(h);
    assert(!result.ok);
    assert.strictEqual(h.coordinator.getReviewSession(), null);
  }
});
test('start rejects Stage 1 session revision and identity substitution', async () => {
  for (const change of [
    session => ({ ...session, session_revision:1 }),
    session => ({ ...session, live_source_marker:{
      ...session.live_source_marker, value:`b4-live-source-v1:${hex('e')}`
    } })
  ]) {
    const reviewStateCore = {
      ...stateCore,
      createInitialReviewSessionState:input => {
        const real = stateCore.createInitialReviewSessionState(input);
        return deepFreeze({ ...real, session:deepFreeze(change(structuredClone(real.session))) });
      }
    };
    const h = await readyHarness({ reviewStateCore });
    const result = await startReady(h);
    assert(!result.ok);
    assert.strictEqual(h.coordinator.getReviewSession(), null);
  }
});
test('start rejects hidden symbol accessor and custom-prototype nested Stage 1 identity', async () => {
  const mutations = [
    session => Object.defineProperty(session.live_source_marker, 'hidden', {
      value:'x', enumerable:false
    }),
    session => { session.live_source_marker[Symbol('hidden')] = 'x'; },
    session => {
      const value=session.live_source_marker.value;
      Object.defineProperty(session.live_source_marker, 'value', {
        enumerable:true, get() { return value; }
      });
    },
    session => Object.setPrototypeOf(session.live_source_marker, { custom:true }),
    session => Object.defineProperty(session.snapshot_identity, 'hidden', {
      value:'x', enumerable:false
    }),
    session => { session.snapshot_identity[Symbol('hidden')] = 'x'; },
    session => {
      const value=session.snapshot_identity.value;
      Object.defineProperty(session.snapshot_identity, 'value', {
        enumerable:true, get() { return value; }
      });
    },
    session => Object.setPrototypeOf(session.snapshot_identity, { custom:true })
  ];
  for (const mutate of mutations) {
    const reviewStateCore = {
      ...stateCore,
      createInitialReviewSessionState:input => {
        const real = stateCore.createInitialReviewSessionState(input);
        const session=structuredClone(real.session);
        mutate(session);
        return deepFreeze({ ...real, session:deepFreeze(session) });
      }
    };
    const h = await readyHarness({ reviewStateCore });
    assert(!(await startReady(h)).ok);
    assert.strictEqual(h.coordinator.getReviewSession(), null);
  }
});

test('source invalidation stales active session and preserves snapshot', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const beforeSession = h.coordinator.getReviewSession();
  const beforeTarget = beforeSession.comparisons['cmp-v1:test'];
  const snapshot = h.coordinator.getRecordSetSnapshot();
  const result = h.coordinator.invalidateReviewSource({
    reasonCode:'relation_changed', occurredAt:at, affectsBinding:false
  });
  assert(result.ok);
  assert.strictEqual(result.value.session_status, 'stale');
  assert.strictEqual(result.value.comparisons['cmp-v1:test'], beforeTarget);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
});
test('invalidation rejects bad Stage 1 revision and preserves active session', async () => {
  const reviewStateCore = {
    ...stateCore,
    invalidateReviewSession:session => deepFreeze({
      ok:true, changed:true,
      session:deepFreeze({ ...session, session_status:'stale',
        session_revision:session.session_revision + 2,
        stale_runtime:{ reason_code:'relation_changed',
          observed_source_epoch:2, occurred_at:at } }),
      diagnostics:[]
    })
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const active = h.coordinator.getReviewSession();
  const result = h.coordinator.invalidateReviewSource({
    reasonCode:'relation_changed', occurredAt:at, affectsBinding:false
  });
  assert(!result.ok);
  assert.strictEqual(h.coordinator.getReviewSession(), active);
  assert.strictEqual(h.coordinator.getReviewSourceEpoch(), 1);
});
test('binding refresh rejects invalidation identity substitution without state mutation', async () => {
  const reviewStateCore = {
    ...stateCore,
    invalidateReviewSession:session => deepFreeze({
      ok:true, changed:true,
      session:deepFreeze({ ...session, session_status:'stale',
        session_revision:session.session_revision + 1,
        live_source_marker:deepFreeze({
          ...session.live_source_marker, value:`b4-live-source-v1:${hex('d')}`
        }),
        stale_runtime:{ reason_code:'input_changed',
          observed_source_epoch:2, occurred_at:at } }),
      diagnostics:[]
    })
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const active = h.coordinator.getReviewSession();
  const result = h.coordinator.beginBindingRefresh({
    reasonCode:'input_changed', occurredAt:at
  });
  assert(!result.ok);
  assert.strictEqual(h.coordinator.getReviewSession(), active);
  assert.strictEqual(h.coordinator.getBindingGeneration(), 1);
});
test('stale to stale is same-session no-op and preserves first reason', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  h.coordinator.invalidateReviewSource({
    reasonCode:'first', occurredAt:at, affectsBinding:false
  });
  const stale = h.coordinator.getReviewSession();
  h.coordinator.invalidateReviewSource({
    reasonCode:'second', occurredAt:'2026-07-23T03:04:06.678Z', affectsBinding:false
  });
  assert.strictEqual(h.coordinator.getReviewSession(), stale);
  assert.strictEqual(stale.stale_runtime.reason_code, 'first');
});
test('binding-affecting invalidation clears runtime and invalidates in-flight start', async () => {
  const h = await readyHarness();
  const result = h.coordinator.invalidateReviewSource({
    reasonCode:'input_changed', occurredAt:at, affectsBinding:true
  });
  assert(result.ok);
  assert.strictEqual(h.coordinator.getBindingRuntime(), null);
  assert.strictEqual(h.coordinator.getBindingGeneration(), 2);
});

// Real integration fixture: actual binding, producer, validator, and Stage 1 state core.
function qid(label) {
  return 'q-' + Buffer.from(String(label)).toString('hex').padEnd(32, '0').slice(0, 32);
}
function conditionCandidate(value, confidence) {
  return { value, confidence, evidence:[{
    type:'keyword', value, source_text:'(test)', effect:'supports', weight:confidence
  }] };
}
function analysis(label, conditionValue, quantityValue) {
  return {
    quantity_id:qid(label), source_field:'source_raw_text', occurrence_index:0,
    source_span:{ start:0, end:4 }, normalized_text:'12 kW',
    quantity:{ source_text:'12 kW', normalized_text:'12 kW',
      quantity:quantityValue,
      unit:{ source:'kW', canonical:'kW', dimension:'power' },
      extraction:{ confidence:0.95, warnings:[] } },
    interval_semantics_candidates:[
      conditionCandidate(conditionValue, 0.9), conditionCandidate('unknown', 0.15)
    ]
  };
}
async function sidecarFor(trace, side, item, file) {
  const records = bindingCore.traceRecords(trace);
  return {
    schema_version:bindingCore.SCHEMA_VERSION, side, source_trace_file:file,
    hash_algorithm:'SHA-256', id_hash_algorithm:'SHA-256/128',
    dataset_signature:await bindingCore.computeDatasetSignature(records),
    generated_at:'2026-07-23T00:00:00Z',
    generator:{ tool:'verification', version:'1' },
    ruleset_version:{ quantity_extraction:'v2.14', semantics_rules:'v2.19',
      auto_applicable_thresholds:{ modeConfidence:0.4, margin:0.2, propertyConfidence:0.7 } },
    records:[{
      trace_id:records[0].trace_id,
      content_hash:await bindingCore.computeRecordContentHash(records[0]),
      analyses:[item]
    }]
  };
}
test('real fixture integrates binding producer validator and Stage 1 core', async () => {
  const reqTrace = { _trace_records:[{
    trace_id:'req-real', source_raw_text:'冷房能力12 kW以上を確保すること。', tags:['冷房能力']
  }] };
  const actTrace = { _trace_records:[{
    trace_id:'act-real', source_raw_text:'冷房能力12.5 kWを実測した。', tags:['冷房能力']
  }] };
  const reqValue = { kind:'interval', lower:{ value:0, inclusive:true }, upper:{ value:50, inclusive:true } };
  const actValue = { kind:'interval', lower:{ value:25, inclusive:true }, upper:{ value:25, inclusive:true } };
  const reqAnnotation = await sidecarFor(
    reqTrace, 'requirement', analysis('real-r', 'acceptable_region', reqValue), 'req.json'
  );
  const actAnnotation = await sidecarFor(
    actTrace, 'actual', analysis('real-a', 'achieved_point', actValue), 'act.json'
  );
  const coordinator = sessionCore.createReviewSessionCoordinator();
  const token = coordinator.beginBindingRefresh({ reasonCode:'initial_binding', occurredAt:at }).value;
  const completed = await coordinator.completeBindingRefresh({
    token, requirementTrace:reqTrace, requirementAnnotation:reqAnnotation,
    actualTrace:actTrace, actualAnnotation:actAnnotation
  });
  assert(completed.ok, JSON.stringify(completed));
  const reqDataset = completed.value.requirement_dataset_signature;
  const actDataset = completed.value.actual_dataset_signature;
  const relations = [{
    requirement_trace_id:'req-real', actual_trace_id:'act-real',
    matcher_a_id:'A', matcher_b_id:'B', relationship:relationship()
  }];
  const context = {
    active_matching_job:null, input_stale:false, matching_stale:false,
    matching_run_id:1, matching_generation:1,
    requirement_dataset_signature:reqDataset, actual_dataset_signature:actDataset,
    matching_dataset_signature:'real-matching-1', relations
  };
  const started = await coordinator.startReviewSession(startInput(() => context));
  assert(started.ok, JSON.stringify(started));
  assert(coordinator.getRecordSetSnapshot().comparisons.length > 0);
  assert(/^b4-live-source-v1:[0-9a-f]{64}$/.test(started.value.live_source_marker.value));
  assert(/^b4-snapshot-v1:[0-9a-f]{64}$/.test(started.value.snapshot_identity.value));
  frozenTree(coordinator.getRecordSetSnapshot());
});

test('Stage 3 transition APIs are public and token stays opaque', async () => {
  const h = await readyHarness();
  assert.strictEqual(typeof h.coordinator.coordinateReviewTransition, 'function');
  assert.strictEqual(typeof h.coordinator.isReviewTransitionInFlight, 'function');
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
  assert((await startReady(h)).ok);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(h.coordinator.getReviewSession(), 'transition_token'), false);
});
test('Stage 3 commits accept and preserves the retained snapshot reference', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const snapshot = h.coordinator.getRecordSetSnapshot();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  assert(result.ok && result.changed, JSON.stringify(result));
  assert.strictEqual(result.session.session_revision, before.session_revision + 1);
  assert.strictEqual(result.session.comparisons['cmp-v1:test'].quantity_extraction.verdict, 'accept');
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});
test('Stage 3 forwards malformed action diagnostic without invoking source callback', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  let called = 0;
  const result = await h.coordinator.coordinateReviewTransition({
    action:{ type:'unknown' }, captureSourceContext:() => { called += 1; return sourceContext(); }, occurredAt:at
  });
  assert.strictEqual(result.diagnostics[0].code, 'review_action_unknown');
  assert.strictEqual(called, 0);
});
test('Stage 3 discard does not capture source and clears session plus snapshot atomically', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const result = await h.coordinator.coordinateReviewTransition({
    action:{ type:'discard_review_session' }, captureSourceContext:null, occurredAt:null
  });
  assert(result.ok && result.changed);
  assert.strictEqual(h.coordinator.getReviewSession(), null);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), null);
  assert(h.coordinator.getBindingRuntime());
});
test('Stage 3 forwards a malformed discard action to the reducer instead of rejecting it as an artifact', async () => {
  // {type:'discard_review_session', extra:true} is not an *exact* discard
  // action, so isDiscard must be false for it -- but it must still reach
  // the authoritative reducer (which reports review_transition_not_allowed
  // for a known action type with the wrong key set) rather than being
  // rejected earlier as review_artifact_invalid just because a null
  // captureSourceContext/occurredAt pair doesn't satisfy the *non*-discard
  // callback contract.
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const snapshot = h.coordinator.getRecordSetSnapshot();
  let captureCalls = 0;
  const result = await h.coordinator.coordinateReviewTransition({
    action:{ type:'discard_review_session', extra:true },
    captureSourceContext:() => { captureCalls += 1; return sourceContext(); },
    occurredAt:null
  });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_transition_not_allowed');
  assert.strictEqual(captureCalls, 0);
  assert.strictEqual(h.coordinator.getReviewSession(), before);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});
test('Stage 3 source invalidation clears the captured transition token immediately', async () => {
  // This must run (and be able to fail on its own named assertion) before
  // any later test that only *incidentally* depends on the same token-clear
  // behavior as a precondition -- otherwise a mutation that breaks this
  // could surface as that later test's precondition assertion failing
  // instead of this test's own direct, dedicated one.
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const gate = deferred();
  h.q.rawSha256Utf8 = async text => { await gate.promise; return bindingCore.rawSha256Utf8(text); };
  const before = h.coordinator.getReviewSession();
  const beforeTarget = before.comparisons['cmp-v1:test'];
  const running = h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  await Promise.resolve();
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), true);
  const invalidation = h.coordinator.invalidateReviewSource({
    reasonCode:'source_changed', occurredAt:at, affectsBinding:false
  });
  assert(invalidation.ok, JSON.stringify(invalidation));
  assert.strictEqual(
    h.coordinator.isReviewTransitionInFlight(), false,
    'source invalidation clears the captured transition token immediately'
  );
  assert.strictEqual(h.coordinator.getReviewSession().session_status, 'stale');
  assert.strictEqual(h.coordinator.getReviewSession().session_revision, before.session_revision + 1);
  assert.strictEqual(h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget);
  gate.resolve();
  const result = await running;
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_session_stale');
});
test('Stage 3 treats a discard-only race as busy rather than an artifact mismatch', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const gate = deferred();
  h.q.rawSha256Utf8 = async text => { await gate.promise; return bindingCore.rawSha256Utf8(text); };
  const running = h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  await Promise.resolve();
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), true);
  assert(h.coordinator.invalidateReviewSource({ reasonCode:'source_changed', occurredAt:at, affectsBinding:false }).ok);
  const discardResult = await h.coordinator.coordinateReviewTransition({
    action:{ type:'discard_review_session' }, captureSourceContext:null, occurredAt:null
  });
  assert(discardResult.ok && discardResult.changed);
  assert.strictEqual(h.coordinator.getReviewSession(), null);
  gate.resolve();
  const result = await running;
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(
    result.diagnostics[0].code, 'review_session_busy',
    'discard-only race was classified as an artifact mismatch instead of busy'
  );
  assert.strictEqual(h.coordinator.getReviewSession(), null);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), null);
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});
test('Stage 3 action snapshot is immune to caller mutation while digest awaits', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const gate = deferred(); h.q.rawSha256Utf8 = async text => { await gate.promise; return bindingCore.rawSha256Utf8(text); };
  const action = acceptAction();
  const running = h.coordinator.coordinateReviewTransition(transitionInput(action));
  await Promise.resolve();
  action.target = 'property_mapping'; action.reviewer = 'changed';
  gate.resolve();
  const result = await running;
  assert(result.ok && result.changed);
  assert.strictEqual(result.session.comparisons['cmp-v1:test'].quantity_extraction.reviewer, 'reviewer');
});
test('Stage 3 single-flight rejects a concurrent transition', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const gate = deferred(); h.q.rawSha256Utf8 = async text => { await gate.promise; return bindingCore.rawSha256Utf8(text); };
  const first = h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  await Promise.resolve();
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), true);
  const secondPromise = h.coordinator.coordinateReviewTransition(transitionInput(acceptAction('property_mapping')));
  const pending = Symbol('pending');
  const observed = await Promise.race([
    secondPromise.then(result => ({ settled:true, result })),
    new Promise(resolve => setTimeout(() => resolve(pending), 0))
  ]);
  assert.notStrictEqual(observed, pending, 'concurrent transition did not fail fast with review_session_busy');
  assert.strictEqual(observed.result.diagnostics[0].code, 'review_session_busy');
  gate.resolve(); assert((await first).ok);
});
test('Stage 3 concurrent transition fails fast with review_session_busy', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const gate = deferred();
  let hashCalls = 0;
  h.q.rawSha256Utf8 = async text => { hashCalls += 1; await gate.promise; return bindingCore.rawSha256Utf8(text); };
  let captureCalls = 0;
  const countingCapture = () => { captureCalls += 1; return sourceContext(); };
  const first = h.coordinator.coordinateReviewTransition(transitionInput(acceptAction(), countingCapture));
  await Promise.resolve();
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), true);
  const hashCallsBeforeSecond = hashCalls;
  const captureCallsBeforeSecond = captureCalls;
  const second = h.coordinator.coordinateReviewTransition(
    transitionInput(acceptAction('property_mapping'), countingCapture)
  );
  // The busy rejection must be decided by the synchronous single-flight gate
  // before any hashing/capture work starts, so it settles well within this
  // turn of the event loop -- it must never actually block on `gate`.
  const pending = Symbol('pending');
  const observed = await Promise.race([
    second.then(result => ({ settled:true, result })),
    new Promise(resolve => setTimeout(() => resolve(pending), 0))
  ]);
  assert.notStrictEqual(
    observed, pending,
    'concurrent transition did not fail fast with review_session_busy'
  );
  assert.strictEqual(observed.result.diagnostics[0].code, 'review_session_busy');
  assert.strictEqual(hashCalls, hashCallsBeforeSecond);
  assert.strictEqual(captureCalls, captureCallsBeforeSecond);
  gate.resolve();
  const firstResult = await first;
  assert(firstResult.ok && firstResult.changed, JSON.stringify(firstResult));
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});
test('Stage 3 source invalidation stales an in-flight transition and prevents commit', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const gate = deferred(); h.q.rawSha256Utf8 = async text => { await gate.promise; return bindingCore.rawSha256Utf8(text); };
  const running = h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  await Promise.resolve();
  assert(h.coordinator.invalidateReviewSource({ reasonCode:'source_changed', occurredAt:at, affectsBinding:false }).ok);
  gate.resolve();
  const result = await running;
  assert.strictEqual(result.diagnostics[0].code, 'review_session_stale');
  assert.strictEqual(h.coordinator.getReviewSession().session_status, 'stale');
  assert.strictEqual(h.coordinator.getReviewSession().comparisons['cmp-v1:test'].quantity_extraction.status, 'unreviewed');
});
test('Stage 3 recapture-only active matching job is busy rather than stale', async () => {
  const h = await readyHarness(); assert((await startReady(h)).ok);
  let captures = 0;
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction(), () => {
    captures += 1;
    return captures === 1 ? sourceContext() : sourceContext({ active_matching_job:{ id:'job-2' } });
  }));
  assert.strictEqual(result.ok, false, 'recapture-time active matching job did not reject the transition');
  assert.strictEqual(result.changed, false, 'recapture-time busy result unexpectedly changed the session');
  assert.strictEqual(result.diagnostics[0]?.code, 'review_session_busy');
  assert.strictEqual(h.coordinator.getReviewSession().session_status, 'active');
});
test('Stage 3 redundant reset is a true no-op', async () => {
  const h = await readyHarness(); assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession(); const snapshot = h.coordinator.getRecordSetSnapshot();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput({ type:'reset_review_target', comparison_id:'cmp-v1:test', target:'quantity_extraction' }));
  assert(result.ok && !result.changed);
  assert.strictEqual(result.session, before);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
});
function poisonedRevisionReviewStateCore(rewriteRevision) {
  return {
    ...stateCore,
    transitionReviewState:(session, action) => {
      const real = stateCore.transitionReviewState(session, action);
      if (!real.ok || !real.changed) return real;
      return deepFreeze({ ...real, session:deepFreeze({
        ...real.session, session_revision:rewriteRevision(session.session_revision)
      }) });
    }
  };
}
test('rejects changed reducer result whose revision increments by more than one', async () => {
  const reviewStateCore = poisonedRevisionReviewStateCore(revision => revision + 2);
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const beforeTarget = before.comparisons['cmp-v1:test'];
  const snapshot = h.coordinator.getRecordSetSnapshot();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
  assert.strictEqual(h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});
test('rejects changed reducer result whose revision does not increment', async () => {
  const reviewStateCore = poisonedRevisionReviewStateCore(revision => revision);
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const beforeTarget = before.comparisons['cmp-v1:test'];
  const snapshot = h.coordinator.getRecordSetSnapshot();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
  assert.strictEqual(h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});
test('Stage 3 pins the source-context callback reference before the first await', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const gate = deferred();
  h.q.rawSha256Utf8 = async text => { await gate.promise; return bindingCore.rawSha256Utf8(text); };
  let swappedCalls = 0;
  const original = () => sourceContext();
  const swapped = () => { swappedCalls += 1; return sourceContext(); };
  const input = transitionInput(acceptAction(), original);
  const running = h.coordinator.coordinateReviewTransition(input);
  await Promise.resolve();
  input.captureSourceContext = swapped;
  gate.resolve();
  const result = await running;
  assert(result.ok && result.changed, JSON.stringify(result));
  assert.strictEqual(swappedCalls, 0);
});
test('Stage 3 preserves a newer transition and session across a stale older transition completion', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  // Each transition's digest computation makes several rawSha256Utf8 calls
  // (relation hash, then marker/identity). Only the *first* call belonging to
  // A, and later the first call belonging to B, should actually block; every
  // other call (Stage 1 session setup, and each transition's remaining
  // internal hashing) must resolve immediately or the two transitions would
  // deadlock waiting on each other's gate.
  const gateA = deferred();
  const gateB = deferred();
  let phase = 'a';
  h.q.rawSha256Utf8 = async text => {
    if (phase === 'a') { phase = 'free'; await gateA.promise; return bindingCore.rawSha256Utf8(text); }
    if (phase === 'b') { phase = 'free'; await gateB.promise; return bindingCore.rawSha256Utf8(text); }
    return bindingCore.rawSha256Utf8(text);
  };
  const runningA = h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  await Promise.resolve();
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), true);
  assert(h.coordinator.invalidateReviewSource({ reasonCode:'source_changed', occurredAt:at, affectsBinding:false }).ok);
  const discardResult = await h.coordinator.coordinateReviewTransition({
    action:{ type:'discard_review_session' }, captureSourceContext:null, occurredAt:null
  });
  assert(discardResult.ok && discardResult.changed);
  assert.strictEqual(h.coordinator.getReviewSession(), null);
  assert((await startReady(h)).ok);
  const sessionB = h.coordinator.getReviewSession();
  phase = 'b';
  const runningB = h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  await Promise.resolve();
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), true);
  gateA.resolve();
  const resultA = await runningA;
  assert.strictEqual(resultA.ok, false);
  assert.strictEqual(resultA.diagnostics[0].code, 'review_session_busy');
  assert.strictEqual(
    h.coordinator.isReviewTransitionInFlight(), true,
    'stale older completion cleared the newer transition token'
  );
  assert.strictEqual(h.coordinator.getReviewSession(), sessionB);
  assert.strictEqual(h.coordinator.getReviewSession().session_status, 'active');
  gateB.resolve();
  const resultB = await runningB;
  assert(resultB.ok && resultB.changed, JSON.stringify(resultB));
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});
test('Stage 3 rejects reducer result that mutates an unrelated target within the same comparison', async () => {
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => {
      const real = stateCore.transitionReviewState(session, action);
      if (!real.ok || !real.changed) return real;
      const comparison = real.session.comparisons[action.comparison_id];
      const corrupted = { ...comparison, property_mapping:{
        ...comparison.property_mapping, note:'tampered'
      } };
      return deepFreeze({ ...real, session:deepFreeze({
        ...real.session,
        comparisons:deepFreeze({ ...real.session.comparisons, [action.comparison_id]:deepFreeze(corrupted) })
      }) });
    }
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const beforeTarget = before.comparisons['cmp-v1:test'];
  const snapshot = h.coordinator.getRecordSetSnapshot();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction('quantity_extraction')));
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
  assert.strictEqual(h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});
test('Stage 3 commit CAS rejects a candidate committed after a reentrant reducer invalidates the source', async () => {
  // stateApi.transitionReviewState is an injectable dependency: nothing stops
  // it from synchronously calling back into the coordinator's own public API
  // while it runs, after sourceChanged has already passed. commitReviewTransition's
  // CAS block is what has to catch that, since nothing else does.
  const box = {};
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => {
      const candidate = stateCore.transitionReviewState(session, action);
      const reentered = box.coordinator.invalidateReviewSource({
        reasonCode:'source_changed_during_reducer', occurredAt:at, affectsBinding:false
      });
      assert(reentered.ok, JSON.stringify(reentered));
      return candidate;
    }
  };
  const h = await readyHarness({ reviewStateCore });
  box.coordinator = h.coordinator;
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const beforeTarget = before.comparisons['cmp-v1:test'];
  const snapshot = h.coordinator.getRecordSetSnapshot();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_session_stale');
  assert.strictEqual(h.coordinator.getReviewSession().session_status, 'stale');
  assert.strictEqual(h.coordinator.getReviewSession().session_revision, before.session_revision + 1);
  assert.strictEqual(h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});
test('Stage 3 reports an artifact identity mismatch when the recomputed snapshot identity diverges', async () => {
  // The snapshot identity is derived only from the immutable record set
  // snapshot and the session's own stored marker -- both fixed for the
  // lifetime of the session -- so a mismatch here can only mean the hash
  // recomputation itself is inconsistent, not that the source changed.
  // Nothing should be staled or committed; the session must stay exactly
  // as it was.
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const beforeTarget = before.comparisons['cmp-v1:test'];
  const snapshot = h.coordinator.getRecordSetSnapshot();
  const realHashParts = h.q.hashParts;
  h.q.hashParts = async (namespace, parts) => namespace === 'b4-review-snapshot-identity-v1'
    ? realHashParts(namespace, ['tampered', ...parts])
    : realHashParts(namespace, parts);
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_identity_mismatch');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
  assert.strictEqual(h.coordinator.getReviewSession().session_status, 'active');
  assert.strictEqual(h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});
test('Stage 3 stales a transition whose recomputed live marker drifts from an unchanged source identity', async () => {
  // Drive both the initial capture and the recapture through the same
  // drifted source context (a different matching_generation, which feeds
  // the marker hash but is otherwise consistent between the two calls).
  // sameTransitionSourceIdentity() compares *before* against *after*, so it
  // stays satisfied -- the only thing that can catch this is comparing the
  // freshly recomputed marker against the session's originally stored one.
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const beforeTarget = before.comparisons['cmp-v1:test'];
  const snapshot = h.coordinator.getRecordSetSnapshot();
  const driftedContext = () => sourceContext({ matching_generation:2 });
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction(), driftedContext));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_session_stale');
  assert.strictEqual(h.coordinator.getReviewSession().session_status, 'stale');
  assert.strictEqual(h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});
test('Stage 3 rejects a no-op result that substitutes a different session reference', async () => {
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => deepFreeze({
      ok:true, changed:false, session:deepFreeze({ ...session }), diagnostics:[]
    })
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const beforeTarget = before.comparisons['cmp-v1:test'];
  const snapshot = h.coordinator.getRecordSetSnapshot();
  const result = await h.coordinator.coordinateReviewTransition(
    transitionInput({ type:'reset_review_target', comparison_id:'cmp-v1:test', target:'quantity_extraction' })
  );
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
  assert.strictEqual(h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});
test('Stage 3 rejects a mutable (non-frozen) reducer result wrapper', async () => {
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => {
      const real = stateCore.transitionReviewState(session, action);
      return { ok:real.ok, changed:real.changed, session:real.session, diagnostics:real.diagnostics };
    }
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const beforeTarget = before.comparisons['cmp-v1:test'];
  const snapshot = h.coordinator.getRecordSetSnapshot();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
  assert.strictEqual(h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});
test('Stage 3 rejects a changed result that substitutes the marker or snapshot identity reference', async () => {
  for (const corrupt of [
    s => ({ ...s, live_source_marker:{ ...s.live_source_marker } }),
    s => ({ ...s, snapshot_identity:{ ...s.snapshot_identity } })
  ]) {
    const reviewStateCore = {
      ...stateCore,
      transitionReviewState:(session, action) => {
        const real = stateCore.transitionReviewState(session, action);
        if (!real.ok || !real.changed) return real;
        return deepFreeze({ ...real, session:deepFreeze(corrupt(real.session)) });
      }
    };
    const h = await readyHarness({ reviewStateCore });
    assert((await startReady(h)).ok);
    const before = h.coordinator.getReviewSession();
    const beforeTarget = before.comparisons['cmp-v1:test'];
    const snapshot = h.coordinator.getRecordSetSnapshot();
    const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(result.changed, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
    assert.strictEqual(h.coordinator.getReviewSession(), before);
    assert.strictEqual(h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget);
    assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
    assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
  }
});
test('Stage 3 rejects a changed target whose fields do not match the requesting action (or is emptied out)', async () => {
  for (const corrupt of [
    // Right key set, wrong semantic content: a different reviewer than the
    // action actually requested.
    target => ({ ...target, reviewer:'someone-else' }),
    // Structurally-shaped but empty out the target entirely.
    () => ({})
  ]) {
    const reviewStateCore = {
      ...stateCore,
      transitionReviewState:(session, action) => {
        const real = stateCore.transitionReviewState(session, action);
        if (!real.ok || !real.changed) return real;
        const comparison = real.session.comparisons[action.comparison_id];
        const corruptedTarget = deepFreeze(corrupt(comparison[action.target]));
        const corrupted = { ...comparison, [action.target]:corruptedTarget };
        return deepFreeze({ ...real, session:deepFreeze({
          ...real.session,
          comparisons:deepFreeze({ ...real.session.comparisons, [action.comparison_id]:deepFreeze(corrupted) })
        }) });
      }
    };
    const h = await readyHarness({ reviewStateCore });
    assert((await startReady(h)).ok);
    const before = h.coordinator.getReviewSession();
    const beforeTarget = before.comparisons['cmp-v1:test'];
    const snapshot = h.coordinator.getRecordSetSnapshot();
    const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
    assert.strictEqual(h.coordinator.getReviewSession(), before);
    assert.strictEqual(h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget);
    assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
    assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
  }
});
test('Stage 3 rejects a changed target carrying a hidden, symbol, or non-plain-prototype property', async () => {
  for (const mutate of [
    v => { Object.defineProperty(v, 'hidden', { value:'x', enumerable:false }); },
    v => { v[Symbol('s')] = 'x'; },
    v => Object.setPrototypeOf(v, { custom:true })
  ]) {
    const reviewStateCore = {
      ...stateCore,
      transitionReviewState:(session, action) => {
        const real = stateCore.transitionReviewState(session, action);
        if (!real.ok || !real.changed) return real;
        const comparison = real.session.comparisons[action.comparison_id];
        const target = structuredClone(comparison[action.target]);
        mutate(target);
        const corrupted = { ...comparison, [action.target]:deepFreeze(target) };
        return deepFreeze({ ...real, session:deepFreeze({
          ...real.session,
          comparisons:deepFreeze({ ...real.session.comparisons, [action.comparison_id]:deepFreeze(corrupted) })
        }) });
      }
    };
    const h = await readyHarness({ reviewStateCore });
    assert((await startReady(h)).ok);
    const before = h.coordinator.getReviewSession();
    const beforeTarget = before.comparisons['cmp-v1:test'];
    const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
    assert.strictEqual(h.coordinator.getReviewSession(), before);
    assert.strictEqual(h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget);
  }
});
test('Stage 3 rejects a changed result that alters overlay_version', async () => {
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => {
      const real = stateCore.transitionReviewState(session, action);
      if (!real.ok || !real.changed) return real;
      return deepFreeze({ ...real, session:deepFreeze({ ...real.session, overlay_version:'tampered' }) });
    }
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 rejects a changed result that carries non-empty diagnostics', async () => {
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => {
      const real = stateCore.transitionReviewState(session, action);
      if (!real.ok || !real.changed) return real;
      return deepFreeze({ ...real, diagnostics:deepFreeze([
        deepFreeze({ code:'review_target_unknown', severity:'warning', detail:'x' })
      ]) });
    }
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 rejects a reset result whose target does not return to the canonical initial state', async () => {
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => {
      const real = stateCore.transitionReviewState(session, action);
      if (!real.ok || !real.changed || action.type !== 'reset_review_target') return real;
      const comparison = real.session.comparisons[action.comparison_id];
      const corrupted = { ...comparison, [action.target]:deepFreeze({
        ...comparison[action.target], status:'unreviewed', verdict:'accept'
      }) };
      return deepFreeze({ ...real, session:deepFreeze({
        ...real.session,
        comparisons:deepFreeze({ ...real.session.comparisons, [action.comparison_id]:deepFreeze(corrupted) })
      }) });
    }
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  assert((await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()))).ok);
  const before = h.coordinator.getReviewSession();
  const beforeTarget = before.comparisons['cmp-v1:test'];
  const result = await h.coordinator.coordinateReviewTransition(
    transitionInput({ type:'reset_review_target', comparison_id:'cmp-v1:test', target:'quantity_extraction' })
  );
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
  assert.strictEqual(h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget);
});
test('Stage 3 rejects a changed result that also mutates an unrelated comparison', async () => {
  const otherId = 'cmp-v1:other';
  const overrides = { recordSet:recordSetStub(at, 'matching-1', ['cmp-v1:test', otherId]) };
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => {
      const real = stateCore.transitionReviewState(session, action);
      if (!real.ok || !real.changed) return real;
      const otherComparison = real.session.comparisons[otherId];
      const corrupted = { ...otherComparison, property_mapping:{
        ...otherComparison.property_mapping, note:'tampered'
      } };
      return deepFreeze({ ...real, session:deepFreeze({
        ...real.session,
        comparisons:deepFreeze({ ...real.session.comparisons, [otherId]:deepFreeze(corrupted) })
      }) });
    }
  };
  const h = await readyHarness({ ...overrides, reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  assert(Object.prototype.hasOwnProperty.call(before.comparisons, otherId), 'fixture must expose an unrelated comparison');
  const beforeOther = before.comparisons[otherId];
  const snapshot = h.coordinator.getRecordSetSnapshot();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
  assert.strictEqual(h.coordinator.getReviewSession().comparisons[otherId], beforeOther);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});
test('Stage 3 keeps a preflight-time busy source from being staled', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const beforeTarget = before.comparisons['cmp-v1:test'];
  const snapshot = h.coordinator.getRecordSetSnapshot();
  const busyContext = () => sourceContext({ active_matching_job:{ id:'job-1' } });
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction(), busyContext));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_session_busy');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
  assert.strictEqual(h.coordinator.getReviewSession().session_status, 'active');
  assert.strictEqual(h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});

test('Stage 3 captures occurredAt once so caller mutation during hash awaits cannot alter the recorded stale time', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const gate = deferred();
  h.q.rawSha256Utf8 = async text => { await gate.promise; return bindingCore.rawSha256Utf8(text); };
  const driftedContext = () => sourceContext({ matching_generation:2 });
  const input = transitionInput(acceptAction(), driftedContext);
  const originalOccurredAt = input.occurredAt;
  const running = h.coordinator.coordinateReviewTransition(input);
  await Promise.resolve();
  input.occurredAt = '2026-07-23T09:09:09.999Z';
  gate.resolve();
  const result = await running;
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_session_stale');
  assert.strictEqual(
    h.coordinator.getReviewSession().stale_runtime.occurred_at, originalOccurredAt,
    'stale_runtime.occurred_at must reflect the originally captured occurredAt, not a mutation made while hashing was in flight'
  );
});
test('Stage 3 pins occurredAt before preflight source validation, not just before hash awaits', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const input = transitionInput(acceptAction());
  const originalOccurredAt = input.occurredAt;
  input.captureSourceContext = () => {
    // A malicious/careless caller mutates occurredAt from inside its own
    // capture callback, before preflightSource ever gets to run -- this is
    // synchronous, so there is no hash await to race against.
    input.occurredAt = '2026-07-23T09:09:09.999Z';
    return sourceContext({ input_stale:true });
  };
  const result = await h.coordinator.coordinateReviewTransition(input);
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_session_stale');
  assert.strictEqual(
    h.coordinator.getReviewSession().stale_runtime.occurred_at, originalOccurredAt,
    'stale_runtime.occurred_at must reflect the originally captured occurredAt, not a mutation made from inside the source-capture callback before preflight validation'
  );
});
test('Stage 3 delegates a transition with no active session to Stage 1 without any capture or hash calls', async () => {
  const h = harness();
  assert.strictEqual(h.coordinator.getReviewSession(), null);
  let captureCalls = 0;
  let hashCalls = 0;
  h.q.rawSha256Utf8 = async text => { hashCalls += 1; return bindingCore.rawSha256Utf8(text); };
  const result = await h.coordinator.coordinateReviewTransition(
    transitionInput(acceptAction(), () => { captureCalls += 1; return sourceContext(); })
  );
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_session_not_started');
  assert.strictEqual(captureCalls, 0);
  assert.strictEqual(hashCalls, 0);
});
test('Stage 3 delegates a non-discard transition against a stale session to Stage 1 without any capture or hash calls', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  assert(h.coordinator.invalidateReviewSource({ reasonCode:'source_changed', occurredAt:at, affectsBinding:false }).ok);
  assert.strictEqual(h.coordinator.getReviewSession().session_status, 'stale');
  let captureCalls = 0;
  let hashCalls = 0;
  h.q.rawSha256Utf8 = async text => { hashCalls += 1; return bindingCore.rawSha256Utf8(text); };
  const result = await h.coordinator.coordinateReviewTransition(
    transitionInput(acceptAction(), () => { captureCalls += 1; return sourceContext(); })
  );
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_session_stale');
  assert.strictEqual(captureCalls, 0);
  assert.strictEqual(hashCalls, 0);
});
test('Stage 3 delegates a known-shaped action with invalid property value types to Stage 1 without any capture or hash calls', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  let captureCalls = 0;
  let hashCalls = 0;
  h.q.rawSha256Utf8 = async text => { hashCalls += 1; return bindingCore.rawSha256Utf8(text); };
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(
    acceptAction('quantity_extraction', { reviewer:123 }),
    () => { captureCalls += 1; return sourceContext(); }
  ));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_transition_not_allowed');
  assert.strictEqual(captureCalls, 0);
  assert.strictEqual(hashCalls, 0);
});
test('Stage 3 rejects a malicious reducer that accepts the satisfaction target via accept_review_target', async () => {
  // Only intercept once satisfaction has genuinely reached 'unreviewed' (all
  // four upstream targets for real) -- otherwise the precondition check
  // alone (status must be 'unreviewed') would mask whether the dedicated
  // UPSTREAM_TARGETS membership check is doing any independent work.
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => {
      if (action.target !== 'satisfaction') return stateCore.transitionReviewState(session, action);
      const comparison = session.comparisons[action.comparison_id];
      const nextComparison = deepFreeze({ ...comparison, satisfaction:deepFreeze({
        status:'reviewed', reviewer:action.reviewer.trim(), reviewed_at:action.reviewed_at, verdict:'accept', note:action.note
      }) });
      return deepFreeze({ ok:true, changed:true, diagnostics:[], session:deepFreeze({
        ...session, session_revision:session.session_revision + 1,
        comparisons:deepFreeze({ ...session.comparisons, [action.comparison_id]:nextComparison })
      }) });
    }
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  for (const target of stateCore.UPSTREAM_TARGETS) {
    assert((await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction(target)))).ok);
  }
  const before = h.coordinator.getReviewSession();
  assert.strictEqual(before.comparisons['cmp-v1:test'].satisfaction.status, 'unreviewed');
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction('satisfaction')));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 rejects a malicious reducer that honors an accept_review_target action carrying an invalid verdict', async () => {
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => {
      const comparison = session.comparisons[action.comparison_id];
      const nextComparison = deepFreeze({ ...comparison, [action.target]:deepFreeze({
        status:'reviewed', reviewer:action.reviewer.trim(), reviewed_at:action.reviewed_at, verdict:'accept', note:action.note
      }) });
      return deepFreeze({ ok:true, changed:true, diagnostics:[], session:deepFreeze({
        ...session, session_revision:session.session_revision + 1,
        comparisons:deepFreeze({ ...session.comparisons, [action.comparison_id]:nextComparison })
      }) });
    }
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const result = await h.coordinator.coordinateReviewTransition(
    transitionInput(acceptAction('quantity_extraction', { verdict:'override_satisfied' }))
  );
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 rejects a malicious reducer that honors a review_satisfaction action with a disallowed verdict', async () => {
  // The forged verdict must match action.verdict exactly -- otherwise a
  // plain field-mismatch against the requested verdict would mask whether
  // the dedicated SATISFACTION_VERDICTS membership check does anything.
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => {
      if (action.type !== 'review_satisfaction') return stateCore.transitionReviewState(session, action);
      const comparison = session.comparisons[action.comparison_id];
      const nextComparison = deepFreeze({ ...comparison, satisfaction:deepFreeze({
        status:'reviewed', reviewer:action.reviewer.trim(), reviewed_at:action.reviewed_at, verdict:action.verdict, note:action.note
      }) });
      return deepFreeze({ ok:true, changed:true, diagnostics:[], session:deepFreeze({
        ...session, session_revision:session.session_revision + 1,
        comparisons:deepFreeze({ ...session.comparisons, [action.comparison_id]:nextComparison })
      }) });
    }
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  for (const target of stateCore.UPSTREAM_TARGETS) {
    assert((await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction(target)))).ok);
  }
  const before = h.coordinator.getReviewSession();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput({
    type:'review_satisfaction', comparison_id:'cmp-v1:test', reviewer:'reviewer', reviewed_at:at, verdict:'bogus', note:null
  }));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 rejects a malicious reducer that marks satisfaction reviewed before all upstream targets are accepted', async () => {
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => {
      if (action.type !== 'review_satisfaction') return stateCore.transitionReviewState(session, action);
      const comparison = session.comparisons[action.comparison_id];
      const nextComparison = deepFreeze({ ...comparison, satisfaction:deepFreeze({
        status:'reviewed', reviewer:action.reviewer.trim(), reviewed_at:action.reviewed_at, verdict:'override_satisfied', note:action.note
      }) });
      return deepFreeze({ ok:true, changed:true, diagnostics:[], session:deepFreeze({
        ...session, session_revision:session.session_revision + 1,
        comparisons:deepFreeze({ ...session.comparisons, [action.comparison_id]:nextComparison })
      }) });
    }
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput({
    type:'review_satisfaction', comparison_id:'cmp-v1:test', reviewer:'reviewer', reviewed_at:at, verdict:'override_satisfied', note:null
  }));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 rejects a malicious reducer that accepts a target using an empty reviewer or malformed timestamp', async () => {
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => {
      if (action.type !== 'accept_review_target') return stateCore.transitionReviewState(session, action);
      const comparison = session.comparisons[action.comparison_id];
      const nextComparison = deepFreeze({ ...comparison, [action.target]:deepFreeze({
        status:'reviewed', reviewer:action.reviewer.trim(), reviewed_at:action.reviewed_at, verdict:'accept', note:action.note
      }) });
      return deepFreeze({ ok:true, changed:true, diagnostics:[], session:deepFreeze({
        ...session, session_revision:session.session_revision + 1,
        comparisons:deepFreeze({ ...session.comparisons, [action.comparison_id]:nextComparison })
      }) });
    }
  };
  for (const badAction of [
    acceptAction('quantity_extraction', { reviewer:'   ' }),
    acceptAction('property_mapping', { reviewed_at:'not-a-timestamp' })
  ]) {
    const h = await readyHarness({ reviewStateCore });
    assert((await startReady(h)).ok);
    const before = h.coordinator.getReviewSession();
    const result = await h.coordinator.coordinateReviewTransition(transitionInput(badAction));
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
    assert.strictEqual(h.coordinator.getReviewSession(), before);
  }
});
test('Stage 3 rejects a malicious reducer that marks satisfaction reviewed with an empty reviewer or malformed timestamp', async () => {
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => {
      if (action.type !== 'review_satisfaction') return stateCore.transitionReviewState(session, action);
      const comparison = session.comparisons[action.comparison_id];
      const nextComparison = deepFreeze({ ...comparison, satisfaction:deepFreeze({
        status:'reviewed', reviewer:action.reviewer.trim(), reviewed_at:action.reviewed_at, verdict:action.verdict, note:action.note
      }) });
      return deepFreeze({ ok:true, changed:true, diagnostics:[], session:deepFreeze({
        ...session, session_revision:session.session_revision + 1,
        comparisons:deepFreeze({ ...session.comparisons, [action.comparison_id]:nextComparison })
      }) });
    }
  };
  for (const badFields of [{ reviewer:'   ' }, { reviewed_at:'not-a-timestamp' }]) {
    const h = await readyHarness({ reviewStateCore });
    assert((await startReady(h)).ok);
    for (const target of stateCore.UPSTREAM_TARGETS) {
      assert((await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction(target)))).ok);
    }
    const before = h.coordinator.getReviewSession();
    const badAction = {
      type:'review_satisfaction', comparison_id:'cmp-v1:test',
      reviewer:'reviewer', reviewed_at:at, verdict:'accept', note:null, ...badFields
    };
    const result = await h.coordinator.coordinateReviewTransition(transitionInput(badAction));
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
    assert.strictEqual(h.coordinator.getReviewSession(), before);
  }
});
test('Stage 3 rejects a malicious reducer that omits the mandatory satisfaction unlock on the fourth upstream accept', async () => {
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => {
      const real = stateCore.transitionReviewState(session, action);
      if (!real.ok || !real.changed || action.type !== 'accept_review_target') return real;
      const comparison = real.session.comparisons[action.comparison_id];
      const previousComparison = session.comparisons[action.comparison_id];
      if (comparison.satisfaction === previousComparison.satisfaction) return real;
      const corrupted = { ...comparison, satisfaction:previousComparison.satisfaction };
      return deepFreeze({ ...real, session:deepFreeze({
        ...real.session,
        comparisons:deepFreeze({ ...real.session.comparisons, [action.comparison_id]:deepFreeze(corrupted) })
      }) });
    }
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const targets = stateCore.UPSTREAM_TARGETS;
  for (let i = 0; i < targets.length - 1; i += 1) {
    assert((await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction(targets[i])))).ok);
  }
  const before = h.coordinator.getReviewSession();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction(targets[targets.length - 1])));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 rejects a malicious reducer that omits the mandatory satisfaction reset when an upstream target is reset', async () => {
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => {
      const real = stateCore.transitionReviewState(session, action);
      if (!real.ok || !real.changed || action.type !== 'reset_review_target' || action.target === 'satisfaction') return real;
      const comparison = real.session.comparisons[action.comparison_id];
      const previousComparison = session.comparisons[action.comparison_id];
      const corrupted = { ...comparison, satisfaction:previousComparison.satisfaction };
      return deepFreeze({ ...real, session:deepFreeze({
        ...real.session,
        comparisons:deepFreeze({ ...real.session.comparisons, [action.comparison_id]:deepFreeze(corrupted) })
      }) });
    }
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  for (const target of stateCore.UPSTREAM_TARGETS) {
    assert((await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction(target)))).ok);
  }
  const before = h.coordinator.getReviewSession();
  assert.strictEqual(before.comparisons['cmp-v1:test'].satisfaction.status, 'unreviewed');
  const result = await h.coordinator.coordinateReviewTransition(
    transitionInput({ type:'reset_review_target', comparison_id:'cmp-v1:test', target:stateCore.UPSTREAM_TARGETS[0] })
  );
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 rejects a changed result whose comparisons map has a non-plain prototype or a hidden id', async () => {
  const corruptions = [
    map => Object.setPrototypeOf({ ...map }, { custom:true }),
    map => {
      const clone = { ...map };
      const firstKey = Object.keys(clone)[0];
      Object.defineProperty(clone, firstKey, { value:clone[firstKey], enumerable:false, configurable:true });
      return clone;
    }
  ];
  for (const corruptMap of corruptions) {
    const reviewStateCore = {
      ...stateCore,
      transitionReviewState:(session, action) => {
        const real = stateCore.transitionReviewState(session, action);
        if (!real.ok || !real.changed) return real;
        return deepFreeze({ ...real, session:deepFreeze({
          ...real.session, comparisons:deepFreeze(corruptMap(real.session.comparisons))
        }) });
      }
    };
    const h = await readyHarness({ reviewStateCore });
    assert((await startReady(h)).ok);
    const before = h.coordinator.getReviewSession();
    const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
    assert.strictEqual(h.coordinator.getReviewSession(), before);
  }
});
test('Stage 3 rejects a malicious reducer failure result with empty or malformed diagnostics', async () => {
  const emptyDiagnostics = {
    ...stateCore,
    transitionReviewState:session => deepFreeze({ ok:false, changed:false, session, diagnostics:[] })
  };
  const malformedDiagnostics = {
    ...stateCore,
    transitionReviewState:session => deepFreeze({
      ok:false, changed:false, session, diagnostics:deepFreeze([deepFreeze({ code:'x' })])
    })
  };
  for (const reviewStateCore of [emptyDiagnostics, malformedDiagnostics]) {
    const h = await readyHarness({ reviewStateCore });
    assert((await startReady(h)).ok);
    const before = h.coordinator.getReviewSession();
    const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
    assert.strictEqual(h.coordinator.getReviewSession(), before);
  }
});
test('Stage 3 rejects a recomputed snapshot identity whose value matches the stored one but the record digest diverges', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const storedIdentity = before.snapshot_identity;
  const recordSetText = bindingCore.canonicalJson(h.coordinator.getRecordSetSnapshot());
  const realRaw = h.q.rawSha256Utf8;
  h.q.rawSha256Utf8 = async text => text === recordSetText ? hex('9') : realRaw(text);
  const realHashParts = h.q.hashParts;
  h.q.hashParts = async (namespace, parts) => namespace === 'b4-review-snapshot-identity-v1'
    ? storedIdentity.value.slice(sessionCore.SNAPSHOT_IDENTITY_PREFIX.length)
    : realHashParts(namespace, parts);
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_identity_mismatch');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 stales a transition whose recomputed live marker carries a different matching_run_id despite an unchanged marker value', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const beforeTarget = before.comparisons['cmp-v1:test'];
  const snapshot = h.coordinator.getRecordSetSnapshot();
  const driftedContext = () => sourceContext({ matching_run_id:99 });
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction(), driftedContext));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_session_stale');
  assert.strictEqual(h.coordinator.getReviewSession().session_status, 'stale');
  assert.strictEqual(h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget);
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});
test('Stage 3 rejects a malicious reducer that reports no-op success for an accept_review_target action that must change', async () => {
  // Stage 1 never returns changed:false for accept_review_target -- when it
  // succeeds at all, something always changes.
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => action.type === 'accept_review_target'
      ? deepFreeze({ ok:true, changed:false, session, diagnostics:[] })
      : stateCore.transitionReviewState(session, action)
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 rejects a malicious reducer that reports no-op success for a review_satisfaction action that must change', async () => {
  // Same as above for review_satisfaction -- Stage 1 has no no-op path for it.
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => action.type === 'review_satisfaction'
      ? deepFreeze({ ok:true, changed:false, session, diagnostics:[] })
      : stateCore.transitionReviewState(session, action)
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  for (const target of stateCore.UPSTREAM_TARGETS) {
    assert((await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction(target)))).ok);
  }
  const before = h.coordinator.getReviewSession();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput({
    type:'review_satisfaction', comparison_id:'cmp-v1:test', reviewer:'reviewer', reviewed_at:at, verdict:'accept', note:null
  }));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 rejects a malicious reducer that reports a changed result for a redundant satisfaction reset', async () => {
  // satisfaction is already at its canonical resting shape on a fresh
  // session (not_eligible, all nulls) -- Stage 1 would report changed:false
  // here, never changed:true, even with a reference-distinct but
  // value-identical replacement and an incremented revision.
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => {
      if (action.type !== 'reset_review_target' || action.target !== 'satisfaction') {
        return stateCore.transitionReviewState(session, action);
      }
      const comparison = session.comparisons[action.comparison_id];
      const nextComparison = deepFreeze({ ...comparison, satisfaction:deepFreeze({ ...comparison.satisfaction }) });
      return deepFreeze({ ok:true, changed:true, diagnostics:[], session:deepFreeze({
        ...session, session_revision:session.session_revision + 1,
        comparisons:deepFreeze({ ...session.comparisons, [action.comparison_id]:nextComparison })
      }) });
    }
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  assert.strictEqual(before.comparisons['cmp-v1:test'].satisfaction.status, 'not_eligible');
  const result = await h.coordinator.coordinateReviewTransition(
    transitionInput({ type:'reset_review_target', comparison_id:'cmp-v1:test', target:'satisfaction' })
  );
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 never accepts an ok:true/changed:false result from the malformed/unknown-action delegation path', async () => {
  // External contract test, not a dedicated single-line mutation category:
  // the malformed/unknown-action delegation call site deliberately omits
  // captured.action, and an ok:true forgery there is rejected by
  // validReducerResult() as a whole. Probing confirmed no single guard
  // inside it is independently, cleanly mutation-testable at this exact
  // call site -- removing just the changed:false branch's !captured.action
  // check still fails safe (validNoOpAction throws on undefined.type,
  // caught by the outer try/catch), so this invariant is verified here as a
  // regression/contract test instead.
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session) => deepFreeze({ ok:true, changed:false, session, diagnostics:[] })
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  let captureCalls = 0;
  const result = await h.coordinator.coordinateReviewTransition({
    action:{ type:'unknown' }, captureSourceContext:() => { captureCalls += 1; return sourceContext(); }, occurredAt:at
  });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(captureCalls, 0);
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 never accepts an ok:true/changed:true result from the malformed/unknown-action delegation path', async () => {
  // Same external contract as above for the changed:true branch. Probing
  // confirmed removing just its !captured.action check also fails safe
  // (the forged session's revision mismatches captured.sessionRevision,
  // which is undefined -- NaN -- at this call site), so this too is a
  // contract/regression test rather than an independently mutation-testable
  // single-line category.
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session) => deepFreeze({
      ok:true, changed:true, diagnostics:[], session:deepFreeze({ ...session, session_revision:session.session_revision + 1 })
    })
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  let captureCalls = 0;
  const result = await h.coordinator.coordinateReviewTransition({
    action:{ type:'unknown' }, captureSourceContext:() => { captureCalls += 1; return sourceContext(); }, occurredAt:at
  });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(captureCalls, 0);
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 counts reviewer and note limits in Unicode code points, matching Stage 1 exactly', async () => {
  // U+1F600 is a surrogate pair in UTF-16 (2 code units, 1 code point) --
  // counting by .length instead of code points would halve the effective
  // limit and reject input Stage 1 itself accepts.
  const emoji = count => '\u{1F600}'.repeat(count);
  const boundaries = [
    { reviewer:emoji(256), note:null, expectOk:true, label:'reviewer at 256 code points' },
    { reviewer:emoji(257), note:null, expectOk:false, label:'reviewer at 257 code points' },
    { reviewer:'reviewer', note:emoji(4096), expectOk:true, label:'note at 4096 code points' },
    { reviewer:'reviewer', note:emoji(4097), expectOk:false, label:'note at 4097 code points' }
  ];
  for (const { reviewer, note, expectOk, label } of boundaries) {
    const h = await readyHarness();
    assert((await startReady(h)).ok);
    const result = await h.coordinator.coordinateReviewTransition(
      transitionInput(acceptAction('quantity_extraction', { reviewer, note }))
    );
    assert.strictEqual(result.ok, expectOk, `${label}: ${JSON.stringify(result)}`);
  }
});

test('Stage 3 rejects a reentrant discard during mid-transition source invalidation as busy, without reviving or corrupting the session', async () => {
  const box = {};
  const reviewStateCore = {
    ...stateCore,
    invalidateReviewSession:(session, payload) => {
      const real = stateCore.invalidateReviewSession(session, payload);
      box.reentrantDiscard = box.coordinator.coordinateReviewTransition({
        action:{ type:'discard_review_session' }, captureSourceContext:null, occurredAt:null
      });
      return real;
    }
  };
  const h = await readyHarness({ reviewStateCore });
  box.coordinator = h.coordinator;
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const beforeTarget = before.comparisons['cmp-v1:test'];
  const snapshot = h.coordinator.getRecordSetSnapshot();
  const driftedContext = () => sourceContext({ matching_generation:2 });
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction(), driftedContext));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_session_stale');
  const reentrantResult = await box.reentrantDiscard;
  assert.strictEqual(reentrantResult.ok, false, JSON.stringify(reentrantResult));
  assert.strictEqual(
    reentrantResult.diagnostics[0].code, 'review_session_busy',
    'a reentrant discard during mid-transition source invalidation must be rejected as busy'
  );
  assert.strictEqual(h.coordinator.getReviewSession().session_status, 'stale');
  assert.strictEqual(h.coordinator.getReviewSession().session_revision, before.session_revision + 1);
  assert.strictEqual(
    h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget,
    'the staled session must not be corrupted or replaced by a revived old session'
  );
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
  assert.strictEqual(h.coordinator.isReviewTransitionInFlight(), false);
});
test('Stage 3 rejects a reentrant invalidateReviewSource call while another source invalidation is in flight', async () => {
  const box = { calls:0 };
  const reviewStateCore = {
    ...stateCore,
    invalidateReviewSession:(session, payload) => {
      box.calls += 1;
      if (box.calls === 1) {
        box.reentrant = box.coordinator.invalidateReviewSource({
          reasonCode:'reentrant', occurredAt:at, affectsBinding:false
        });
      }
      return stateCore.invalidateReviewSession(session, payload);
    }
  };
  const h = await readyHarness({ reviewStateCore });
  box.coordinator = h.coordinator;
  assert((await startReady(h)).ok);
  const result = h.coordinator.invalidateReviewSource({
    reasonCode:'source_changed', occurredAt:at, affectsBinding:false
  });
  assert(result.ok, JSON.stringify(result));
  assert.strictEqual(box.calls, 1, 'reentrant invalidateReviewSource must not reach the dependency a second time');
  assert.strictEqual(box.reentrant.ok, false, JSON.stringify(box.reentrant));
  assert.strictEqual(box.reentrant.diagnostics[0].code, 'review_session_busy');
  assert.strictEqual(h.coordinator.getReviewSession().session_status, 'stale');
});
test('Stage 3 rejects a reentrant beginBindingRefresh call while a source invalidation is in flight', async () => {
  const box = { calls:0 };
  const reviewStateCore = {
    ...stateCore,
    invalidateReviewSession:(session, payload) => {
      box.calls += 1;
      if (box.calls === 1) {
        box.reentrant = box.coordinator.beginBindingRefresh({ reasonCode:'reentrant', occurredAt:at });
      }
      return stateCore.invalidateReviewSession(session, payload);
    }
  };
  const h = await readyHarness({ reviewStateCore });
  box.coordinator = h.coordinator;
  assert((await startReady(h)).ok);
  const generationBefore = h.coordinator.getBindingGeneration();
  const result = h.coordinator.beginBindingRefresh({ reasonCode:'source_changed', occurredAt:at });
  assert(result.ok, JSON.stringify(result));
  assert.strictEqual(box.calls, 1, 'reentrant beginBindingRefresh must not reach the dependency a second time');
  assert.strictEqual(box.reentrant.ok, false, JSON.stringify(box.reentrant));
  assert.strictEqual(box.reentrant.diagnostics[0].code, 'review_session_busy');
  assert.strictEqual(h.coordinator.getBindingGeneration(), generationBefore + 1);
});
test('Stage 3 uses its own trusted UPSTREAM_TARGETS, not the injectable stateApi one', async () => {
  const reviewStateCore = { ...stateCore, UPSTREAM_TARGETS:Object.freeze([]) };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  assert(result.ok && result.changed, JSON.stringify(result));
  assert.strictEqual(result.session.comparisons['cmp-v1:test'].quantity_extraction.verdict, 'accept');
});
test('Stage 3 uses its own trusted SATISFACTION_VERDICTS, not the injectable stateApi one', async () => {
  const reviewStateCore = { ...stateCore, SATISFACTION_VERDICTS:Object.freeze([]) };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  for (const target of stateCore.UPSTREAM_TARGETS) {
    assert((await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction(target)))).ok);
  }
  const result = await h.coordinator.coordinateReviewTransition(transitionInput({
    type:'review_satisfaction', comparison_id:'cmp-v1:test', reviewer:'reviewer', reviewed_at:at, verdict:'accept', note:null
  }));
  assert(result.ok && result.changed, JSON.stringify(result));
  assert.strictEqual(result.session.comparisons['cmp-v1:test'].satisfaction.verdict, 'accept');
});
test('Stage 3 rejects an accept_review_target satisfaction forgery even when the injected stateApi.UPSTREAM_TARGETS includes it', async () => {
  const reviewStateCore = {
    ...stateCore,
    UPSTREAM_TARGETS:Object.freeze([...stateCore.UPSTREAM_TARGETS, 'satisfaction']),
    transitionReviewState:(session, action) => {
      if (action.target !== 'satisfaction') return stateCore.transitionReviewState(session, action);
      const comparison = session.comparisons[action.comparison_id];
      const nextComparison = deepFreeze({ ...comparison, satisfaction:deepFreeze({
        status:'reviewed', reviewer:action.reviewer.trim(), reviewed_at:action.reviewed_at, verdict:'accept', note:action.note
      }) });
      return deepFreeze({ ok:true, changed:true, diagnostics:[], session:deepFreeze({
        ...session, session_revision:session.session_revision + 1,
        comparisons:deepFreeze({ ...session.comparisons, [action.comparison_id]:nextComparison })
      }) });
    }
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  for (const target of stateCore.UPSTREAM_TARGETS) {
    assert((await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction(target)))).ok);
  }
  const before = h.coordinator.getReviewSession();
  assert.strictEqual(before.comparisons['cmp-v1:test'].satisfaction.status, 'unreviewed');
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction('satisfaction')));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 rejects a discard result that reports failure with an otherwise-exact success shape', async () => {
  // Every field except `ok` matches the one legitimate discard success shape,
  // isolating the `result.ok === true` clause specifically.
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => action.type === 'discard_review_session'
      ? deepFreeze({ ok:false, changed:true, session:null, diagnostics:[] })
      : stateCore.transitionReviewState(session, action)
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const result = await h.coordinator.coordinateReviewTransition({
    action:{ type:'discard_review_session' }, captureSourceContext:null, occurredAt:null
  });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert(result.diagnostics.length >= 1, `expected at least one diagnostic: ${JSON.stringify(result)}`);
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 rejects a discard result that reports a no-op with an otherwise-exact success shape', async () => {
  // Every field except `changed` matches the one legitimate discard success
  // shape, isolating the `result.changed === true` clause specifically.
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => action.type === 'discard_review_session'
      ? deepFreeze({ ok:true, changed:false, session:null, diagnostics:[] })
      : stateCore.transitionReviewState(session, action)
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const result = await h.coordinator.coordinateReviewTransition({
    action:{ type:'discard_review_session' }, captureSourceContext:null, occurredAt:null
  });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert(result.diagnostics.length >= 1, `expected at least one diagnostic: ${JSON.stringify(result)}`);
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 rejects a discard result that reports success with a non-null session, with an otherwise-exact success shape', async () => {
  // Every field except `session` matches the one legitimate discard success
  // shape, isolating the `result.session === null` clause specifically.
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => action.type === 'discard_review_session'
      ? deepFreeze({ ok:true, changed:true, session, diagnostics:[] })
      : stateCore.transitionReviewState(session, action)
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const result = await h.coordinator.coordinateReviewTransition({
    action:{ type:'discard_review_session' }, captureSourceContext:null, occurredAt:null
  });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert(result.diagnostics.length >= 1, `expected at least one diagnostic: ${JSON.stringify(result)}`);
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 rejects a discard result that reports success with a non-empty diagnostics array, with an otherwise-exact success shape', async () => {
  // Every field except `diagnostics` matches the one legitimate discard
  // success shape, isolating the `result.diagnostics.length === 0` clause
  // specifically.
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:(session, action) => action.type === 'discard_review_session'
      ? deepFreeze({ ok:true, changed:true, session:null, diagnostics:deepFreeze([
        deepFreeze({ code:'review_session_stale', severity:'error', detail:'Review session is stale.' })
      ]) })
      : stateCore.transitionReviewState(session, action)
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const beforeTarget = before.comparisons['cmp-v1:test'];
  const snapshot = h.coordinator.getRecordSetSnapshot();
  const result = await h.coordinator.coordinateReviewTransition({
    action:{ type:'discard_review_session' }, captureSourceContext:null, occurredAt:null
  });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert(result.diagnostics.length >= 1, `expected at least one diagnostic: ${JSON.stringify(result)}`);
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
  assert.strictEqual(
    h.coordinator.getReviewSession().comparisons['cmp-v1:test'], beforeTarget,
    'the active session and its comparisons must be unchanged, not partially discarded'
  );
  assert.strictEqual(h.coordinator.getRecordSetSnapshot(), snapshot);
});
test('Stage 3 rejects a failure result with more than one diagnostic entry', async () => {
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:session => deepFreeze({
      ok:false, changed:false, session,
      diagnostics:deepFreeze([
        deepFreeze({ code:'review_target_unknown', severity:'error', detail:'Review target is unknown.' }),
        deepFreeze({ code:'review_target_unknown', severity:'error', detail:'Review target is unknown.' })
      ])
    })
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 rejects a failure diagnostic whose severity or detail does not match the official Stage 1 registry', async () => {
  for (const badEntry of [
    { code:'review_target_unknown', severity:'warning', detail:'Review target is unknown.' },
    { code:'review_target_unknown', severity:'error', detail:'tampered' }
  ]) {
    const reviewStateCore = {
      ...stateCore,
      transitionReviewState:session => deepFreeze({
        ok:false, changed:false, session, diagnostics:deepFreeze([deepFreeze(badEntry)])
      })
    };
    const h = await readyHarness({ reviewStateCore });
    assert((await startReady(h)).ok);
    const before = h.coordinator.getReviewSession();
    const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
    assert.strictEqual(result.ok, false, JSON.stringify(result));
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
    assert.strictEqual(h.coordinator.getReviewSession(), before);
  }
});
test('Stage 3 rejects a failure diagnostic with a code outside the Stage 1 registry', async () => {
  const reviewStateCore = {
    ...stateCore,
    transitionReviewState:session => deepFreeze({
      ok:false, changed:false, session,
      diagnostics:deepFreeze([deepFreeze({ code:'totally_made_up', severity:'error', detail:'nope' })])
    })
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 normalizes an unknown error reviewCode to review_artifact_invalid', async () => {
  const h = await readyHarness();
  assert((await startReady(h)).ok);
  const before = h.coordinator.getReviewSession();
  h.q.rawSha256Utf8 = async () => {
    const error = new Error('bogus');
    error.reviewCode = 'not_a_real_code';
    throw error;
  };
  const result = await h.coordinator.coordinateReviewTransition(transitionInput(acceptAction()));
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assert.strictEqual(h.coordinator.getReviewSession(), before);
});
test('Stage 3 rejects an invalidation success result with non-empty diagnostics', async () => {
  const reviewStateCore = {
    ...stateCore,
    invalidateReviewSession:(session, payload) => {
      const real = stateCore.invalidateReviewSession(session, payload);
      return deepFreeze({ ...real, diagnostics:deepFreeze([
        deepFreeze({ code:'review_session_stale', severity:'error', detail:'x' })
      ]) });
    }
  };
  const h = await readyHarness({ reviewStateCore });
  assert((await startReady(h)).ok);
  const active = h.coordinator.getReviewSession();
  const result = h.coordinator.invalidateReviewSource({ reasonCode:'x', occurredAt:at, affectsBinding:false });
  assert.strictEqual(result.ok, false, JSON.stringify(result));
  assert.strictEqual(h.coordinator.getReviewSession(), active);
  assert.strictEqual(h.coordinator.getReviewSourceEpoch(), 1);
});

(async () => {
  for (const entry of tests) {
    try {
      await entry.fn();
      passed += 1;
    } catch (error) {
      console.error(`[FAIL] ${entry.name}`);
      throw error;
    }
  }
  console.log(`trace comparison review session core verification: ${passed}/${total} passed`);
})().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});

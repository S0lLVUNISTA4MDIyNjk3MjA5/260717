'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const corePath = path.join(__dirname, '..', 'trace_comparison_review_state_core.js');
const core = require(corePath);
let passed = 0;
let total = 0;
function test(name, fn) {
  total += 1;
  try { fn(); passed += 1; }
  catch (error) { console.error(`[FAIL] ${name}`); throw error; }
}
function frozenTree(value) {
  if (value && typeof value === 'object') {
    assert(Object.isFrozen(value));
    Object.values(value).forEach(frozenTree);
  }
}
function descriptorTree(value) {
  if (!value || typeof value !== 'object') return value;
  return Reflect.ownKeys(value).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return [typeof key === 'symbol' ? `symbol:${String(key.description)}` : `string:${key}`, {
      configurable:descriptor.configurable, enumerable:descriptor.enumerable, writable:descriptor.writable,
      value:descriptorTree(descriptor.value)
    }];
  });
}
function assertUnchangedAndUnfrozen(value, beforeJson, beforeDescriptors) {
  assert.strictEqual(Object.isFrozen(value), false);
  assert.strictEqual(JSON.stringify(value), beforeJson);
  assert.deepStrictEqual(descriptorTree(value), beforeDescriptors);
}
function makeNonEnumerable(object, key) {
  const value=object[key];
  Object.defineProperty(object, key, {value, enumerable:false, writable:true, configurable:true});
}
function makeGetter(object, key, counter) {
  const value=object[key];
  Object.defineProperty(object, key, {enumerable:true, configurable:true, get() { counter.count += 1; return value; }});
}
function makeSetter(object, key, counter) {
  Object.defineProperty(object, key, {enumerable:true, configurable:true, set(_) { counter.count += 1; }});
}
const hex = char => char.repeat(64);
function marker() {
  return {
    value:`b4-live-source-v1:${hex('a')}`, review_source_epoch:0, matching_run_id:1,
    matching_generation:1, binding_generation:1, binding_snapshot_digest:`SHA-256:${hex('b')}`,
    binding_identity:`b4-binding-v1:${hex('c')}`, requirement_dataset_signature:`QA-SHA256:${hex('d')}`,
    actual_dataset_signature:`QA-SHA256:${hex('e')}`, matching_dataset_signature:'match-1',
    relation_snapshot_digest:`SHA-256:${hex('f')}`
  };
}
function snapshot() {
  return { value:`b4-snapshot-v1:${hex('1')}`, schema_version:'trace-comparison/1.0-rc2', record_set_digest:`SHA-256:${hex('2')}` };
}
const at = '2026-07-23T03:04:05.678Z';
function make(ids = ['cmp-v1:a', 'cmp-v1:b']) {
  return core.createInitialReviewSessionState({ sessionId:' session-1 ', startedAt:at, startedBy:' reviewer ', liveSourceMarker:marker(), snapshotIdentity:snapshot(), comparisonIds:ids });
}
function accept(session, id, target, extras = {}) {
  return core.transitionReviewState(session, { type:'accept_review_target', comparison_id:id, target,
    reviewer:' reviewer ', reviewed_at:at, verdict:'accept', note:null, ...extras });
}
function acceptAll(session, id = 'cmp-v1:a') {
  for (const target of core.UPSTREAM_TARGETS) session = accept(session, id, target).session;
  return session;
}
function satisfy(session, verdict = 'accept') {
  return core.transitionReviewState(session, { type:'review_satisfaction', comparison_id:'cmp-v1:a', reviewer:'reviewer', reviewed_at:at, verdict, note:'' });
}

test('CommonJS API', () => assert.strictEqual(typeof core.transitionReviewState, 'function'));
test('API and constants are frozen', () => { assert(Object.isFrozen(core)); assert(Object.isFrozen(core.UPSTREAM_TARGETS)); });
test('browser global API', () => {
  const context = { structuredClone, console }; context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(corePath, 'utf8'), context, { filename:corePath });
  assert.strictEqual(typeof context.TraceComparisonReviewStateCore.createInitialReviewSessionState, 'function');
  assert(Object.isFrozen(context.TraceComparisonReviewStateCore));
});
const created = make();
test('initial overlay generation and trimming', () => { assert(created.ok); assert.strictEqual(created.session.session_id, 'session-1'); assert.strictEqual(created.session.started_by, 'reviewer'); });
test('two comparisons initialized', () => assert.deepStrictEqual(Object.keys(created.session.comparisons), ['cmp-v1:a', 'cmp-v1:b']));
test('session marker snapshot deep frozen', () => frozenTree(created.session));
test('caller marker is cloned', () => { const m = marker(); const result = core.createInitialReviewSessionState({sessionId:'s', startedAt:at, startedBy:'r', liveSourceMarker:m, snapshotIdentity:snapshot(), comparisonIds:['cmp-v1:a']}); m.value='changed'; assert.notStrictEqual(result.session.live_source_marker.value, 'changed'); });
test('invalid and duplicate comparison IDs rejected', () => { assert(!make(['bad']).ok); assert(!make(['cmp-v1:a', 'cmp-v1:a']).ok); });
test('sparse comparison ID arrays are rejected', () => {
  const cases=[new Array(1), Array(2), ['cmp-v1:a', 'cmp-v1:b', 'cmp-v1:c'], ['cmp-v1:a', 'cmp-v1:b']];
  cases[1][1]='cmp-v1:b';
  delete cases[2][1];
  delete cases[3][0];
  cases.push(['cmp-v1:a', 'cmp-v1:b']); delete cases[4][1]; cases[4].length=2;
  for (const ids of cases) assert(!make(ids).ok);
});
test('comparison ID array index accessors and extra properties are rejected without invocation', () => {
  const count={count:0}; const accessor=['cmp-v1:a']; makeGetter(accessor, '0', count);
  const extra=['cmp-v1:a']; extra.extra=true;
  assert(!make(accessor).ok); assert.strictEqual(count.count, 0); assert(!make(extra).ok);
});
test('exact marker fields enforced', () => { const m=marker(); m.extra=true; assert(!core.createInitialReviewSessionState({sessionId:'s', startedAt:at, startedBy:'r', liveSourceMarker:m, snapshotIdentity:snapshot(), comparisonIds:['cmp-v1:a']}).ok); });
test('marker and snapshot identity failures use identity diagnostic', () => {
  const m=marker(); m.value='bad';
  const a=core.createInitialReviewSessionState({sessionId:'s', startedAt:at, startedBy:'r', liveSourceMarker:m, snapshotIdentity:snapshot(), comparisonIds:['cmp-v1:a']});
  const s=snapshot(); s.record_set_digest='bad';
  const b=core.createInitialReviewSessionState({sessionId:'s', startedAt:at, startedBy:'r', liveSourceMarker:marker(), snapshotIdentity:s, comparisonIds:['cmp-v1:a']});
  assert.strictEqual(a.diagnostics[0].code, 'review_artifact_identity_mismatch');
  assert.strictEqual(b.diagnostics[0].code, 'review_artifact_identity_mismatch');
});
test('hidden and symbol marker snapshot extras rejected', () => {
  for (const [field, factory] of [['liveSourceMarker', marker], ['snapshotIdentity', snapshot]]) {
    for (const decorate of [value => Object.defineProperty(value, 'hidden', {value:true}), value => { value[Symbol('extra')]=true; }]) {
      const value=factory(); decorate(value);
      const input={sessionId:'s', startedAt:at, startedBy:'r', liveSourceMarker:marker(), snapshotIdentity:snapshot(), comparisonIds:['cmp-v1:a']};
      input[field]=value;
      const result=core.createInitialReviewSessionState(input);
      assert(!result.ok); assert.strictEqual(result.diagnostics[0].code, 'review_artifact_identity_mismatch');
    }
  }
});
test('initial input marker and snapshot require enumerable data properties', () => {
  const cases=[];
  for (const decorate of [
    value => { makeNonEnumerable(value, 'sessionId'); return null; },
    value => { const count={count:0}; makeGetter(value, 'sessionId', count); return count; },
    value => { const count={count:0}; makeSetter(value, 'sessionId', count); return count; }
  ]) {
    const input={sessionId:'s', startedAt:at, startedBy:'r', liveSourceMarker:marker(), snapshotIdentity:snapshot(), comparisonIds:['cmp-v1:a']};
    cases.push([input, decorate(input)]);
  }
  for (const [field, key, factory] of [['liveSourceMarker','value',marker], ['snapshotIdentity','value',snapshot]]) {
    for (const decorate of [
      value => { makeNonEnumerable(value, key); return null; },
      value => { const count={count:0}; makeGetter(value, key, count); return count; },
      value => { const count={count:0}; makeSetter(value, key, count); return count; }
    ]) {
      const value=factory(); const counter=decorate(value);
      const candidate={sessionId:'s', startedAt:at, startedBy:'r', liveSourceMarker:marker(), snapshotIdentity:snapshot(), comparisonIds:['cmp-v1:a']};
      candidate[field]=value; cases.push([candidate, counter]);
    }
  }
  for (const [candidate, counter] of cases) {
    const result=core.createInitialReviewSessionState(candidate);
    assert(!result.ok); if (counter) assert.strictEqual(counter.count, 0);
  }
});

let session = created.session;
const originalSecond = session.comparisons['cmp-v1:b'];
for (let index = 0; index < core.UPSTREAM_TARGETS.length; index += 1) {
  const target = core.UPSTREAM_TARGETS[index];
  const before = session;
  const result = accept(session, 'cmp-v1:a', target);
  test(`accept ${target}`, () => {
    assert(result.ok && result.changed); assert.strictEqual(result.session.session_revision, before.session_revision + 1);
    assert.strictEqual(result.session.comparisons['cmp-v1:b'], originalSecond);
    assert.strictEqual(result.session.live_source_marker, before.live_source_marker);
    const untouched=core.UPSTREAM_TARGETS.find(candidate => candidate !== target);
    assert.strictEqual(result.session.comparisons['cmp-v1:a'][untouched], before.comparisons['cmp-v1:a'][untouched]);
  });
  session = result.session;
  if (index < 3) test(`satisfaction remains ineligible after ${index + 1}`, () => assert.strictEqual(session.comparisons['cmp-v1:a'].satisfaction.status, 'not_eligible'));
}
test('fourth accept makes satisfaction unreviewed', () => assert.strictEqual(session.comparisons['cmp-v1:a'].satisfaction.status, 'unreviewed'));
test('eligibility true only after upstream accepts', () => { assert(core.deriveSatisfactionEligibility(session, 'cmp-v1:a')); assert(!core.deriveSatisfactionEligibility(created.session, 'cmp-v1:a')); });
test('early satisfaction rejected', () => { const r=satisfy(created.session); assert(!r.ok && !r.changed); assert.strictEqual(r.diagnostics[0].code, 'review_satisfaction_not_eligible'); assert.strictEqual(r.session, created.session); });
for (const verdict of core.SATISFACTION_VERDICTS) {
  test(`satisfaction verdict ${verdict}`, () => { const r=satisfy(session, verdict); assert(r.ok && r.changed); assert.strictEqual(r.session.comparisons['cmp-v1:a'].satisfaction.verdict, verdict); });
}
const recordSet = Object.freeze({ comparisons:Object.freeze([{ comparison_id:'cmp-v1:a', automatic_judgement:Object.freeze({satisfied:true}), numeric_comparison:Object.freeze({value:3}) }]) });
test('derive accepted automatic satisfaction', () => assert.strictEqual(core.deriveHumanSatisfaction(satisfy(session, 'accept').session, 'cmp-v1:a', recordSet), true));
test('derive overrides', () => { assert.strictEqual(core.deriveHumanSatisfaction(satisfy(session, 'override_satisfied').session, 'cmp-v1:a', recordSet), true); assert.strictEqual(core.deriveHumanSatisfaction(satisfy(session, 'override_unsatisfied').session, 'cmp-v1:a', recordSet), false); });
const reviewed = satisfy(session).session;
test('derive all reviewed', () => { assert(core.deriveAllReviewed(reviewed, 'cmp-v1:a')); assert(!core.deriveAllReviewed(session, 'cmp-v1:a')); });
test('record set remains unchanged', () => { const before=JSON.stringify(recordSet); core.deriveHumanSatisfaction(reviewed, 'cmp-v1:a', recordSet); assert.strictEqual(JSON.stringify(recordSet), before); assert.strictEqual(recordSet.comparisons[0].numeric_comparison.value, 3); });
test('upstream reset invalidates satisfaction', () => { const r=core.transitionReviewState(reviewed, {type:'reset_review_target', comparison_id:'cmp-v1:a', target:'property_mapping'}); assert(r.ok && r.changed); assert.strictEqual(r.session.comparisons['cmp-v1:a'].satisfaction.status, 'not_eligible'); assert.strictEqual(r.session.comparisons['cmp-v1:a'].satisfaction.verdict, null); });
test('satisfaction reset', () => { const r=core.transitionReviewState(reviewed, {type:'reset_review_target', comparison_id:'cmp-v1:a', target:'satisfaction'}); assert.strictEqual(r.session.comparisons['cmp-v1:a'].satisfaction.status, 'unreviewed'); assert.strictEqual(r.session.comparisons['cmp-v1:a'].satisfaction.verdict, null); });
test('redundant reset is same-reference no-op', () => { const r=core.transitionReviewState(created.session, {type:'reset_review_target', comparison_id:'cmp-v1:a', target:'quantity_extraction'}); assert(r.ok && !r.changed); assert.strictEqual(r.session, created.session); assert.strictEqual(r.session.session_revision, 0); });
test('failure and no-op do not freeze or mutate mutable session', () => {
  for (const action of [{type:'explode'}, {type:'reset_review_target', comparison_id:'cmp-v1:a', target:'quantity_extraction'}]) {
    const mutable=structuredClone(created.session); const json=JSON.stringify(mutable); const descriptors=descriptorTree(mutable);
    const result=core.transitionReviewState(mutable, action);
    assert.strictEqual(result.session, mutable); assert(Object.isFrozen(result)); assert(Object.isFrozen(result.diagnostics));
    result.diagnostics.forEach(item => assert(Object.isFrozen(item)));
    assertUnchangedAndUnfrozen(mutable, json, descriptors);
  }
});
test('mutable session requiring accept is rejected without mutation', () => {
  const mutable=structuredClone(created.session); const json=JSON.stringify(mutable); const descriptors=descriptorTree(mutable);
  const result=accept(mutable, 'cmp-v1:a', 'quantity_extraction');
  assert(!result.ok && !result.changed); assert.strictEqual(result.session, mutable);
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assertUnchangedAndUnfrozen(mutable, json, descriptors);
});
test('mutable session discard is rejected without mutation', () => {
  const mutable=structuredClone(created.session); const json=JSON.stringify(mutable); const descriptors=descriptorTree(mutable);
  const result=core.transitionReviewState(mutable, {type:'discard_review_session'});
  assert(!result.ok && !result.changed); assert.strictEqual(result.session, mutable);
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assertUnchangedAndUnfrozen(mutable, json, descriptors);
});
const invalidated = core.invalidateReviewSession(reviewed, {reasonCode:' source_changed ', observedSourceEpoch:2, occurredAt:at});
test('active to stale', () => { assert(invalidated.ok && invalidated.changed); assert.strictEqual(invalidated.session.session_status, 'stale'); assert.strictEqual(invalidated.session.session_revision, reviewed.session_revision + 1); assert.strictEqual(invalidated.session.stale_runtime.reason_code, 'source_changed'); });
test('active to stale preserves shared frozen references', () => {
  assert.strictEqual(invalidated.session.live_source_marker, reviewed.live_source_marker);
  assert.strictEqual(invalidated.session.snapshot_identity, reviewed.snapshot_identity);
  assert.strictEqual(invalidated.session.comparisons, reviewed.comparisons);
});
test('mutable session requiring active to stale is rejected without mutation', () => {
  const mutable=structuredClone(reviewed); const json=JSON.stringify(mutable); const descriptors=descriptorTree(mutable);
  const result=core.invalidateReviewSession(mutable, {reasonCode:'changed', observedSourceEpoch:2, occurredAt:at});
  assert(!result.ok && !result.changed); assert.strictEqual(result.session, mutable);
  assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  assertUnchangedAndUnfrozen(mutable, json, descriptors);
});
test('stale to stale preserves first reason', () => { const r=core.invalidateReviewSession(invalidated.session, {bad:true}); assert(r.ok && !r.changed); assert.strictEqual(r.session, invalidated.session); assert.strictEqual(r.session.stale_runtime.reason_code, 'source_changed'); });
test('stale no-op does not freeze or mutate mutable session', () => {
  const mutable=structuredClone(invalidated.session); const json=JSON.stringify(mutable); const descriptors=descriptorTree(mutable);
  const result=core.invalidateReviewSession(mutable, {bad:true});
  assert(result.ok && !result.changed); assert.strictEqual(result.session, mutable); assert(Object.isFrozen(result));
  assertUnchangedAndUnfrozen(mutable, json, descriptors);
});
test('stale rejects non-discard', () => { const r=core.transitionReviewState(invalidated.session, {type:'reset_review_target', comparison_id:'cmp-v1:a', target:'satisfaction'}); assert(!r.ok); assert.strictEqual(r.diagnostics[0].code, 'review_session_stale'); });
test('active and stale discard', () => { for (const s of [reviewed, invalidated.session]) { const r=core.transitionReviewState(s, {type:'discard_review_session'}); assert(r.ok && r.changed && r.session === null); } });
test('missing session rejects discard', () => assert.strictEqual(core.transitionReviewState(null, {type:'discard_review_session'}).diagnostics[0].code, 'review_session_not_started'));
test('double accept rejected without mutation', () => { const r=accept(session, 'cmp-v1:a', 'quantity_extraction'); assert(!r.ok && !r.changed); assert.strictEqual(r.session, session); });
test('missing and unknown-string action types use unknown-action error', () => {
  for (const action of [{}, {type:'explode'}]) {
    const diagnostic=core.transitionReviewState(session, action).diagnostics[0];
    assert.strictEqual(diagnostic.code, 'review_action_unknown');
    assert.strictEqual(diagnostic.severity, 'error');
  }
});
test('unknown target and comparison', () => { assert.strictEqual(core.transitionReviewState(session, {type:'reset_review_target', comparison_id:'cmp-v1:a', target:'bad'}).diagnostics[0].code, 'review_target_unknown'); assert.strictEqual(core.transitionReviewState(session, {type:'reset_review_target', comparison_id:'cmp-v1:missing', target:'satisfaction'}).diagnostics[0].code, 'review_target_unknown'); });
test('correctly typed unknown comparison uses target-unknown error', () => {
  const diagnostic=core.transitionReviewState(session, {type:'reset_review_target', comparison_id:'cmp-v1:missing', target:'satisfaction'}).diagnostics[0];
  assert.strictEqual(diagnostic.code, 'review_target_unknown');
  assert.strictEqual(diagnostic.severity, 'error');
});
test('known action property type errors use transition warning', () => {
  const actions=[
    {type:'reset_review_target', comparison_id:42, target:'quantity_extraction'},
    {type:'reset_review_target', comparison_id:'cmp-v1:a', target:42},
    {type:'accept_review_target', comparison_id:'cmp-v1:a', target:'quantity_extraction', reviewer:42, reviewed_at:at, verdict:'accept', note:null},
    {type:'accept_review_target', comparison_id:'cmp-v1:a', target:'quantity_extraction', reviewer:'r', reviewed_at:42, verdict:'accept', note:null},
    {type:'accept_review_target', comparison_id:'cmp-v1:a', target:'quantity_extraction', reviewer:'r', reviewed_at:at, verdict:42, note:null},
    {type:'accept_review_target', comparison_id:'cmp-v1:a', target:'quantity_extraction', reviewer:'r', reviewed_at:at, verdict:'accept', note:42}
  ];
  for (const action of actions) {
    const diagnostic=core.transitionReviewState(session, action).diagnostics[0];
    assert.strictEqual(diagnostic.code, 'review_transition_not_allowed');
    assert.strictEqual(diagnostic.severity, 'warning');
  }
});
test('extra action property rejected', () => assert.strictEqual(core.transitionReviewState(created.session, {type:'reset_review_target', comparison_id:'cmp-v1:a', target:'quantity_extraction', extra:true}).diagnostics[0].code, 'review_transition_not_allowed'));
test('inherited required property rejected', () => { const action=Object.create({target:'quantity_extraction'}); Object.assign(action,{type:'reset_review_target',comparison_id:'cmp-v1:a'}); assert(!core.transitionReviewState(created.session, action).ok); });
test('hidden symbol and custom-prototype actions rejected', () => {
  const base=() => ({type:'reset_review_target', comparison_id:'cmp-v1:a', target:'quantity_extraction'});
  const hidden=base(); Object.defineProperty(hidden, 'hidden', {value:true});
  const symbol=base(); symbol[Symbol('extra')]=true;
  const custom=Object.assign(Object.create({inherited:true}), base());
  for (const action of [hidden, symbol, custom]) {
    const result=core.transitionReviewState(created.session, action);
    assert(!result.ok); assert.strictEqual(result.diagnostics[0].code, 'review_transition_not_allowed');
  }
});
test('action required properties must be enumerable data properties', () => {
  for (const decorate of [
    action => { makeNonEnumerable(action, 'type'); return null; },
    action => { const count={count:0}; makeGetter(action, 'type', count); return count; },
    action => { const count={count:0}; makeSetter(action, 'type', count); return count; }
  ]) {
    const action={type:'accept_review_target', comparison_id:'cmp-v1:a', target:'quantity_extraction', reviewer:'r', reviewed_at:at, verdict:'accept', note:null};
    const counter=decorate(action); const result=core.transitionReviewState(created.session, action);
    assert(!result.ok); assert.strictEqual(result.diagnostics[0].code, 'review_transition_not_allowed');
    assert.strictEqual(result.diagnostics[0].severity, 'warning');
    if (counter) assert.strictEqual(counter.count, 0);
  }
});
test('non-string action type uses transition warning', () => {
  const diagnostic=core.transitionReviewState(created.session, {type:7}).diagnostics[0];
  assert.strictEqual(diagnostic.code, 'review_transition_not_allowed');
  assert.strictEqual(diagnostic.severity, 'warning');
});
test('session comparison and target exact records reject hidden symbol and custom prototype', () => {
  const mutateCases=[
    session => Object.defineProperty(session, 'hidden', {value:true}),
    session => { session[Symbol('extra')]=true; },
    session => Object.setPrototypeOf(session, {custom:true}),
    session => Object.defineProperty(session.comparisons['cmp-v1:a'], 'hidden', {value:true}),
    session => { session.comparisons['cmp-v1:a'][Symbol('extra')]=true; },
    session => Object.setPrototypeOf(session.comparisons['cmp-v1:a'], {custom:true}),
    session => Object.defineProperty(session.comparisons['cmp-v1:a'].quantity_extraction, 'hidden', {value:true}),
    session => { session.comparisons['cmp-v1:a'].quantity_extraction[Symbol('extra')]=true; },
    session => Object.setPrototypeOf(session.comparisons['cmp-v1:a'].quantity_extraction, {custom:true})
  ];
  for (const mutate of mutateCases) {
    const malformed=structuredClone(created.session); mutate(malformed);
    const result=core.transitionReviewState(malformed, {type:'reset_review_target', comparison_id:'cmp-v1:a', target:'quantity_extraction'});
    assert(!result.ok); assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  }
});
test('session comparison target and stale runtime require enumerable data properties', () => {
  const subjects=[
    [() => structuredClone(created.session), object => object, 'session_id'],
    [() => structuredClone(created.session), object => object, 'live_source_marker'],
    [() => structuredClone(created.session), object => object.comparisons['cmp-v1:a'], 'quantity_extraction'],
    [() => structuredClone(created.session), object => object.comparisons['cmp-v1:a'].quantity_extraction, 'status'],
    [() => structuredClone(invalidated.session), object => object.stale_runtime, 'reason_code']
  ];
  for (const [factory, select, key] of subjects) {
    for (const kind of ['non-enumerable', 'getter', 'setter']) {
      const malformed=factory(); const subject=select(malformed); const counter={count:0};
      if (kind === 'non-enumerable') makeNonEnumerable(subject, key);
      else if (kind === 'getter') makeGetter(subject, key, counter);
      else makeSetter(subject, key, counter);
      const result=core.transitionReviewState(malformed, {type:'discard_review_session'});
      assert(!result.ok); assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
      assert.strictEqual(counter.count, 0);
    }
  }
});
test('comparisons container rejects hidden accessor symbol and custom prototype', () => {
  const cases=[];
  const hidden=structuredClone(created.session); Object.defineProperty(hidden.comparisons, 'hidden', {value:{arbitrary:true}}); cases.push([hidden, null]);
  const accessor=structuredClone(created.session); const count={count:0};
  Object.defineProperty(accessor.comparisons, 'cmp-v1:hidden', {enumerable:true, get() { count.count += 1; return accessor.comparisons['cmp-v1:a']; }}); cases.push([accessor, count]);
  const symbol=structuredClone(created.session); symbol.comparisons[Symbol('extra')]=symbol.comparisons['cmp-v1:a']; cases.push([symbol, null]);
  const custom=structuredClone(created.session); Object.setPrototypeOf(custom.comparisons, {custom:true}); cases.push([custom, null]);
  for (const [malformed, counter] of cases) {
    const result=core.transitionReviewState(malformed, {type:'discard_review_session'});
    assert(!result.ok); assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
    if (counter) assert.strictEqual(counter.count, 0);
  }
});
test('invalidation payload exact record and timestamp diagnostics', () => {
  const base=() => ({reasonCode:'changed', observedSourceEpoch:2, occurredAt:at});
  const hidden=base(); Object.defineProperty(hidden, 'hidden', {value:true});
  const symbol=base(); symbol[Symbol('extra')]=true;
  const custom=Object.assign(Object.create({inherited:true}), base());
  for (const payload of [hidden, symbol, custom]) {
    const result=core.invalidateReviewSession(created.session, payload);
    assert.strictEqual(result.diagnostics[0].code, 'review_transition_not_allowed');
    assert.strictEqual(result.diagnostics[0].severity, 'warning');
  }
  const badTime=core.invalidateReviewSession(created.session, {...base(), occurredAt:'bad'});
  assert.strictEqual(badTime.diagnostics[0].code, 'reviewed_at_invalid');
  assert.strictEqual(badTime.diagnostics[0].severity, 'error');
});
test('invalidation payload required properties must be enumerable data properties', () => {
  for (const decorate of [
    payload => { makeNonEnumerable(payload, 'reasonCode'); return null; },
    payload => { const count={count:0}; makeGetter(payload, 'reasonCode', count); return count; },
    payload => { const count={count:0}; makeSetter(payload, 'reasonCode', count); return count; }
  ]) {
    const payload={reasonCode:'changed', observedSourceEpoch:2, occurredAt:at}; const counter=decorate(payload);
    const result=core.invalidateReviewSession(created.session, payload);
    assert(!result.ok); assert.strictEqual(result.diagnostics[0].code, 'review_transition_not_allowed');
    if (counter) assert.strictEqual(counter.count, 0);
  }
});
test('diagnostic mapping fixes identity and transition severities', () => {
  const transition=core.transitionReviewState(created.session, {type:'reset_review_target', comparison_id:'cmp-v1:a', target:'quantity_extraction', extra:true});
  assert.strictEqual(transition.diagnostics[0].severity, 'warning');
  const malformed=structuredClone(created.session); malformed.live_source_marker.value='bad';
  const identity=core.transitionReviewState(malformed, {type:'discard_review_session'});
  assert.strictEqual(identity.diagnostics[0].code, 'review_artifact_identity_mismatch');
  assert.strictEqual(identity.diagnostics[0].severity, 'error');
});
test('invalid verdict', () => assert.strictEqual(satisfy(session, 'maybe').diagnostics[0].code, 'review_verdict_invalid'));
test('empty reviewer', () => assert.strictEqual(accept(created.session, 'cmp-v1:a', 'quantity_extraction', {reviewer:'  '}).diagnostics[0].code, 'reviewer_required'));
test('reviewer Unicode boundary', () => { assert(accept(created.session, 'cmp-v1:a', 'quantity_extraction', {reviewer:'😀'.repeat(256)}).ok); assert(!accept(created.session, 'cmp-v1:a', 'quantity_extraction', {reviewer:'😀'.repeat(257)}).ok); });
test('note Unicode boundary', () => { assert(accept(created.session, 'cmp-v1:a', 'quantity_extraction', {note:'😀'.repeat(4096)}).ok); assert(!accept(created.session, 'cmp-v1:a', 'quantity_extraction', {note:'😀'.repeat(4097)}).ok); });
test('invalid timestamp', () => assert.strictEqual(accept(created.session, 'cmp-v1:a', 'quantity_extraction', {reviewed_at:'2026-07-23'}).diagnostics[0].code, 'reviewed_at_invalid'));
test('revision overflow fails closed', () => { const overflow=Object.freeze({...created.session, session_revision:Number.MAX_SAFE_INTEGER}); const r=accept(overflow, 'cmp-v1:a', 'quantity_extraction'); assert(!r.ok && !r.changed); assert.strictEqual(r.session, overflow); });
test('input session remains unchanged', () => { const before=JSON.stringify(created.session); accept(created.session, 'cmp-v1:a', 'quantity_extraction'); assert.strictEqual(JSON.stringify(created.session), before); });
test('deterministic action sequence', () => { const a=accept(make().session,'cmp-v1:a','quantity_extraction').session; const b=accept(make().session,'cmp-v1:a','quantity_extraction').session; assert.deepStrictEqual(a,b); });
test('derive rejects unknown comparison', () => {
  assert(!core.deriveSatisfactionEligibility(session, 'cmp-v1:missing'));
  assert.strictEqual(core.deriveHumanSatisfaction(session, 'cmp-v1:missing', recordSet), null);
  assert(!core.deriveAllReviewed(session, 'cmp-v1:missing'));
});
test('derive rejects structurally invalid session', () => {
  assert(!core.deriveSatisfactionEligibility({}, 'cmp-v1:a'));
  assert.strictEqual(core.deriveHumanSatisfaction({}, 'cmp-v1:a', recordSet), null);
  assert(!core.deriveAllReviewed({}, 'cmp-v1:a'));
});
test('stale fully reviewed preserves eligibility boundary and all-reviewed derivation', () => {
  assert(core.deriveSatisfactionEligibility(reviewed, 'cmp-v1:a'));
  assert(core.deriveAllReviewed(reviewed, 'cmp-v1:a'));
  assert(!core.deriveSatisfactionEligibility(invalidated.session, 'cmp-v1:a'));
  assert(core.deriveAllReviewed(invalidated.session, 'cmp-v1:a'));
});
test('stale override_satisfied preserves human satisfaction', () => {
  const active=satisfy(session, 'override_satisfied').session;
  const stale=core.invalidateReviewSession(active, {reasonCode:'source_changed', observedSourceEpoch:2, occurredAt:at}).session;
  assert.strictEqual(core.deriveHumanSatisfaction(active, 'cmp-v1:a', recordSet), true);
  assert.strictEqual(core.deriveHumanSatisfaction(stale, 'cmp-v1:a', recordSet), true);
  assert(core.deriveAllReviewed(stale, 'cmp-v1:a'));
});
test('stale override_unsatisfied preserves human satisfaction', () => {
  const active=satisfy(session, 'override_unsatisfied').session;
  const stale=core.invalidateReviewSession(active, {reasonCode:'source_changed', observedSourceEpoch:2, occurredAt:at}).session;
  assert.strictEqual(core.deriveHumanSatisfaction(active, 'cmp-v1:a', recordSet), false);
  assert.strictEqual(core.deriveHumanSatisfaction(stale, 'cmp-v1:a', recordSet), false);
  assert(core.deriveAllReviewed(stale, 'cmp-v1:a'));
});
test('stale accept derives immutable automatic satisfaction', () => {
  const active=satisfy(session, 'accept').session;
  const stale=core.invalidateReviewSession(active, {reasonCode:'source_changed', observedSourceEpoch:2, occurredAt:at}).session;
  assert.strictEqual(core.deriveHumanSatisfaction(active, 'cmp-v1:a', recordSet), true);
  assert.strictEqual(core.deriveHumanSatisfaction(stale, 'cmp-v1:a', recordSet), true);
  assert(core.deriveAllReviewed(stale, 'cmp-v1:a'));
});
test('core has no prohibited runtime dependency', () => { const source=fs.readFileSync(corePath,'utf8'); for (const token of ['document.', 'localStorage', 'sessionStorage', 'IndexedDB', 'XMLHttpRequest', 'fetch(', 'new Blob', 'setTimeout(', 'Math.random', 'Date.now']) assert(!source.includes(token), token); });

console.log(`trace comparison review state core verification: ${passed}/${total} passed`);

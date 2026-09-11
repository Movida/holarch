'use strict';
// framework-guard (chantier 7 U2, §9.4) : refuse tout Write/Edit sous framework/, docs/, tools/ ou sur
// mission/OBJECTIVE.md — hors du cas normal d'une instance qui écrit dans son propre arbre mission/.
// Modèle : framework/tests/sleep-guard-instance-vivante.test.js (racine jetable via unites-indexees-setup.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');
const { makeRoot, runHook } = require('./unites-indexees-setup.js');

function guard(root, instance, rel, toolName = 'Write') {
  return runHook(
    'framework-guard',
    { session_id: crypto.randomUUID(), cwd: root, tool_name: toolName, tool_input: { file_path: path.join(root, rel) } },
    { HOLARCH_ROOT: root, HOLARCH_INSTANCE: instance },
  );
}
function decision(o) { return (o.hookSpecificOutput || {}).permissionDecision; }

test('framework-guard : refuse Write/Edit sous framework/, docs/, tools/ et sur mission/OBJECTIVE.md', () => {
  const root = makeRoot();
  const instance = 'concepteur/enfant';

  for (const rel of ['framework/quelquechose.js', 'docs/quelquechose.md', 'tools/quelquechose.js', 'mission/OBJECTIVE.md']) {
    let out = guard(root, instance, rel, 'Write');
    assert.equal(decision(out), 'deny', `Write ${rel} devrait être refusé : ${JSON.stringify(out)}`);
    out = guard(root, instance, rel, 'Edit');
    assert.equal(decision(out), 'deny', `Edit ${rel} devrait être refusé : ${JSON.stringify(out)}`);
  }
});

test('framework-guard : autorise Write/Edit sous mission/shared/ et sous l\'arbre normal d\'une instance', () => {
  const root = makeRoot();
  const instance = 'concepteur/enfant';

  for (const rel of ['mission/shared/concepteur/enfant/livrable.md', 'mission/concepteur/enfant/MEMORY.md']) {
    let out = guard(root, instance, rel, 'Write');
    assert.deepEqual(out, {}, `Write ${rel} devrait être autorisé : ${JSON.stringify(out)}`);
    out = guard(root, instance, rel, 'Edit');
    assert.deepEqual(out, {}, `Edit ${rel} devrait être autorisé : ${JSON.stringify(out)}`);
  }
});

test('framework-guard : inerte hors Write/Edit (ex. Bash)', () => {
  const root = makeRoot();
  const out = guard(root, 'concepteur/enfant', 'framework/quelquechose.js', 'Bash');
  assert.deepEqual(out, {});
});

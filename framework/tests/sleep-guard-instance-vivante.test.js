'use strict';
// sleep-guard et fichiers en vol d'une autre instance vivante (dogfooding §3.9 du 2026-09-10,
// docs/diagnostics/2026-09-10-dogfooding-reveil-par-condition.md) : un parent qui clôt sa session pendant
// que son enfant détaché écrit ne doit pas être forcé de committer les fichiers de l'enfant.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { makeRoot, runHook, status, gitInit, gitCommitAt } = require('./unites-indexees-setup.js');

function guard(root, instance) {
  return runHook('sleep-guard', { session_id: crypto.randomUUID(), cwd: root }, { HOLARCH_ROOT: root, HOLARCH_INSTANCE: instance, HOLARCH_COMMIT: 'oui' });
}
function lock(root, chemin, pid) {
  const p = path.join(root, 'mission', '.holarch', 'live', `${chemin.replace(/\//g, '-')}.json`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ pid }));
  return p;
}

test('sleep-guard : les fichiers en vol d\'un enfant détaché vivant ne bloquent pas le parent ; les siens, si', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'mission/concepteur/STATUS.md'), status('DELIVERED'));
  const env = gitInit(root);
  gitCommitAt(root, env, '2026-09-10T08:00:00Z', 'état propre');

  // Enfant à l'œuvre : sous-arbre, fiche registre et zone shared modifiés, sans verrou → à committer par le parent (ancien comportement).
  fs.appendFileSync(path.join(root, 'mission/concepteur/enfant/MEMORY.md'), 'en cours\n');
  fs.appendFileSync(path.join(root, 'mission/registry/instances/concepteur-enfant.md'), '| Note | en cours |\n');
  fs.mkdirSync(path.join(root, 'mission/shared/concepteur/enfant'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mission/shared/concepteur/enfant/NOTE.md'), 'brouillon\n');
  let out = guard(root, 'concepteur');
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /3 fichier\(s\) de mission\/ non committé\(s\)/);

  // Même état, enfant vivant (verrou sur un pid vivant) : rien à exiger du parent.
  const lockPath = lock(root, 'concepteur/enfant', process.pid);
  out = guard(root, 'concepteur');
  assert.equal(out.decision, undefined, out.reason);

  // Les fichiers propres du parent restent exigés, et seulement eux.
  fs.appendFileSync(path.join(root, 'mission/concepteur/MEMORY.md'), 'à committer\n');
  out = guard(root, 'concepteur');
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /1 fichier\(s\) de mission\/ non committé\(s\)/);

  // Verrou sur un pid mort : l'enfant n'est plus vivant, ses restes redeviennent à committer.
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999 }));
  out = guard(root, 'concepteur');
  assert.match(out.reason, /4 fichier\(s\) de mission\/ non committé\(s\)/);
});

test('sleep-guard : un parent vivant ne masque que sa fiche registre pour l\'enfant, jamais le sous-arbre de l\'enfant', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'mission/concepteur/enfant/STATUS.md'), status('DELIVERED'));
  const env = gitInit(root);
  gitCommitAt(root, env, '2026-09-10T08:00:00Z', 'état propre');
  lock(root, 'concepteur', process.pid);
  fs.appendFileSync(path.join(root, 'mission/registry/instances/concepteur.md'), '| Note | parent en cours |\n');
  assert.equal(guard(root, 'concepteur/enfant').decision, undefined);
  fs.appendFileSync(path.join(root, 'mission/concepteur/enfant/MEMORY.md'), 'à committer\n');
  const out = guard(root, 'concepteur/enfant');
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /1 fichier\(s\) de mission\/ non committé\(s\)/);
});

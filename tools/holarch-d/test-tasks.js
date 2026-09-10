'use strict';
/** Tests de tasks.js — état des tâches sur disque, isolé via HOLARCH_HOME. */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tasks = require('./tasks');

function racineTemporaire() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-d-tasks-'));
  process.env.HOLARCH_HOME = d;
  return d;
}

test('creer initialise une tâche avec les défauts attendus', () => {
  racineTemporaire();
  const t = tasks.creer({ id: 'abc', prompt: 'q', level: 1, space: 'default' });
  assert.strictEqual(t.state, 'queued');
  assert.strictEqual(t.cost_usd, null);
  assert.ok(t.createdAt);
});

test('lire relit exactement ce que creer a écrit', () => {
  racineTemporaire();
  tasks.creer({ id: 'abc', prompt: 'q', level: 1, space: 'default' });
  const relue = tasks.lire('abc');
  assert.strictEqual(relue.id, 'abc');
  assert.strictEqual(relue.prompt, 'q');
});

test('lire renvoie null pour une tâche inexistante', () => {
  racineTemporaire();
  assert.strictEqual(tasks.lire('inexistante'), null);
});

test('patch fusionne des champs sans perdre les autres', () => {
  racineTemporaire();
  tasks.creer({ id: 'abc', prompt: 'q', level: 1, space: 'default' });
  tasks.patch('abc', { state: 'running', startedAt: '2026-01-01T00:00:00Z' });
  const relue = tasks.lire('abc');
  assert.strictEqual(relue.state, 'running');
  assert.strictEqual(relue.prompt, 'q'); // pas perdu
});

test('patch échoue explicitement sur une tâche inexistante', () => {
  racineTemporaire();
  assert.throws(() => tasks.patch('inexistante', { state: 'done' }), /introuvable/);
});

test('lister filtre par espace et par état, trie du plus récent au plus ancien', async () => {
  racineTemporaire();
  tasks.creer({ id: 'a', prompt: 'q', level: 1, space: 'default' });
  await new Promise((r) => { setTimeout(r, 5); });
  tasks.creer({ id: 'b', prompt: 'q', level: 1, space: 'default' });
  tasks.creer({ id: 'c', prompt: 'q', level: 1, space: 'autre' });
  tasks.patch('a', { state: 'done' });

  assert.deepStrictEqual(tasks.lister({ space: 'default' }).map((t) => t.id), ['b', 'a']);
  assert.deepStrictEqual(tasks.lister({ state: 'done' }).map((t) => t.id), ['a']);
  assert.strictEqual(tasks.lister({ limit: 1 }).length, 1);
});

test('écriture et lecture de RESULT.md', () => {
  racineTemporaire();
  tasks.creer({ id: 'abc', prompt: 'q', level: 1, space: 'default' });
  assert.strictEqual(tasks.lireResultat('abc'), null);
  tasks.ecrireResultat('abc', '# Verdict\nOK');
  assert.match(tasks.lireResultat('abc'), /Verdict/);
});

test('ajouterLigneTranscript s\'ajoute sans écraser', () => {
  racineTemporaire();
  tasks.creer({ id: 'abc', prompt: 'q', level: 1, space: 'default' });
  tasks.ajouterLigneTranscript('abc', '{"type":"system"}');
  tasks.ajouterLigneTranscript('abc', '{"type":"result"}');
  const contenu = fs.readFileSync(tasks.cheminTranscript('abc'), 'utf8').trim().split('\n');
  assert.strictEqual(contenu.length, 2);
});

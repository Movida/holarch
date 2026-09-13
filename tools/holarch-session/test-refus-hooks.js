'use strict';
// Tests de refus.js — volet « refus de garde-fou (hooks) » (chantier 14, docs/IMPLEMENTATION.md §15.5).
// Fixture .jsonl synthétique sous fixtures/transcriptions-refus/ (aucune transcription réelle : voir la
// note de limite en tête de refus.js — cette instance n'a pas eu accès à ~/.claude/projects).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const refus = require('./refus');

const REFUS = path.join(__dirname, 'refus.js');
const FIXTURE = path.join(__dirname, 'fixtures', 'transcriptions-refus');

test('nomGardeFou : premier mot du contenu entre crochets, sans liste codée en dur', () => {
  assert.equal(refus.nomGardeFou('garde-fou ON_SLEEP 1/3'), 'ON_SLEEP');
  assert.equal(refus.nomGardeFou('garde-fou git-guard'), 'git-guard');
  assert.equal(refus.nomGardeFou('garde-fou path-guard'), 'path-guard'); // garde-fou pas encore écrit ailleurs dans ce fichier : reconnu quand même
});

test('causeMessage : coupe au premier « : » isolé, chemins/commandes entre apostrophes inverses neutralisés', () => {
  assert.equal(refus.causeMessage("Avant de terminer : MEMORY.md incomplet."), 'Avant de terminer');
  assert.equal(
    refus.causeMessage("`git commit -a` indexe tout l'arbre, y compris ce qu'une autre session a en cours : nomme tes fichiers avec `git add mission/...` puis `git commit` sans -a."),
    "‹…› indexe tout l'arbre, y compris ce qu'une autre session a en cours",
  );
});

test('analyserMessageGardeFou : reconnaît le préfixe, rejette tout le reste (fusible spawn, courrier… ne sont pas des garde-fous)', () => {
  const a = refus.analyserMessageGardeFou('[HOLARCH · garde-fou git-guard] `git add .` indexe tout l\'arbre : restreins à mission/.');
  assert.equal(a.nom, 'git-guard');
  assert.equal(a.cause, "‹…› indexe tout l'arbre");
  assert.equal(refus.analyserMessageGardeFou('[HOLARCH · fusible spawn] budget dépassé'), null);
  assert.equal(refus.analyserMessageGardeFou('texte quelconque'), null);
});

test('messagesGardeFouDansLigne : parcours générique (tool_result, texte imbriqué), dédoublonné dans une même ligne', () => {
  const ligne = { message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: '[HOLARCH · garde-fou X] a : b' }, { type: 'text', text: '[HOLARCH · garde-fou X] a : b' }] }] } };
  assert.deepEqual(refus.messagesGardeFouDansLigne(ligne), ['[HOLARCH · garde-fou X] a : b']);
  const ailleurs = { type: 'system', data: { note: '[HOLARCH · garde-fou Y] c : d' } };
  assert.deepEqual(refus.messagesGardeFouDansLigne(ailleurs), ['[HOLARCH · garde-fou Y] c : d']);
  assert.deepEqual(refus.messagesGardeFouDansLigne({ rien: 'à voir ici' }), []);
});

test('listerJsonl : fichier plat et sous-dossier (avec subagents/), triés, nom de session = chemin relatif sans extension', () => {
  const l = refus.listerJsonl(FIXTURE);
  const sessions = l.map((f) => f.session);
  assert.deepEqual(sessions, ['sess-a', 'sess-b/sess-b', 'sess-b/subagents/agent-1']);
});

test('releverHooks : ventile la fixture synthétique par garde-fou et par cause — mesure de référence de ce module', () => {
  const r = refus.releverHooks(FIXTURE);
  assert.equal(r.sessions.length, 3);
  assert.equal(r.totalRefus, 7); // 5 (sess-a) + 1 (sess-b/sess-b) + 1 (sess-b/subagents/agent-1)
  assert.deepEqual(r.sessions.map((s) => [s.session, s.refus]), [['sess-a', 5], ['sess-b/sess-b', 1], ['sess-b/subagents/agent-1', 1]]);
  assert.deepEqual(r.parGardeFou, [
    { nom: 'git-guard', n: 3 },
    { nom: 'framework-guard', n: 2 },
    { nom: 'ON_SLEEP', n: 1 },
    { nom: 'ON_ORIENT', n: 1 },
  ]);
  // framework-guard : deux chemins différents (docs/ROADMAP.md, mission/OBJECTIVE.md), même cause normalisée.
  const fw = r.formes.find((f) => f.nom === 'framework-guard');
  assert.equal(fw.n, 2);
  assert.equal(fw.sessions, 1);
  assert.match(fw.cause, /est hors de ton arbre de mission/);
  // git-guard « commit -a » répété dans deux sessions distinctes ET dédoublonné dans la même ligne de sess-a.
  const commitA = r.formes.find((f) => f.nom === 'git-guard' && !/sans pathspec/.test(f.cause));
  assert.ok(commitA, 'cause git-guard "commit -a" introuvable');
  assert.equal(commitA.n, 2);
  assert.equal(commitA.sessions, 2);
  const sansPathspec = r.formes.find((f) => /sans pathspec/.test(f.cause));
  assert.equal(sansPathspec.n, 1);
});

test('formaterHooks : texte lisible, garde-fou et causes visibles', () => {
  const r = refus.releverHooks(FIXTURE);
  const t = refus.formaterHooks(r, 15);
  assert.match(t, /3 session\(s\)\/transcription\(s\) · 7 refus/);
  assert.match(t, /3 × garde-fou git-guard/);
  assert.match(t, /2 × garde-fou framework-guard/);
  assert.match(t, /1 × garde-fou ON_SLEEP/);
  assert.match(t, /1 × garde-fou ON_ORIENT/);
});

test('releverHooks : dossier absent → zéro refus, jamais une exception', () => {
  const r = refus.releverHooks(path.join(FIXTURE, 'absent'));
  assert.equal(r.totalRefus, 0);
  assert.deepEqual(r.sessions, []);
});

test('CLI --transcriptions : sortie texte et --json cohérentes avec releverHooks', () => {
  const texte = spawnSync('node', [REFUS, '--transcriptions', FIXTURE, '--dir', path.join(FIXTURE, 'absent-allowlist')], { encoding: 'utf8' });
  assert.equal(texte.status, 0);
  assert.match(texte.stdout, /refus d'allowlist/);
  assert.match(texte.stdout, /refus de garde-fou \(hooks\)/);
  assert.match(texte.stdout, /7 refus/);
  const j = spawnSync('node', [REFUS, '--transcriptions', FIXTURE, '--dir', path.join(FIXTURE, 'absent-allowlist'), '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(j.stdout);
  assert.equal(parsed.hooks.totalRefus, 7);
  assert.equal(parsed.allowlist.totalRefus, 0);
});

// MSG-UTIL-001 (2026-09-13) : `--transcriptions` seul mêlait deux missions dans une même sortie (le bloc
// allowlist porte sur la mission courante). Il ne relève désormais que les hooks, sauf --dir/--root explicite.
test('CLI --transcriptions seul : aucun bloc allowlist, ni en texte ni en JSON', () => {
  const texte = spawnSync('node', [REFUS, '--transcriptions', FIXTURE], { encoding: 'utf8' });
  assert.equal(texte.status, 0);
  assert.doesNotMatch(texte.stdout, /refus d'allowlist/);
  assert.match(texte.stdout, /refus de garde-fou \(hooks\)/);
  const j = spawnSync('node', [REFUS, '--transcriptions', FIXTURE, '--json'], { encoding: 'utf8' });
  const parsed = JSON.parse(j.stdout);
  assert.equal(parsed.hooks.totalRefus, 7);
  assert.equal(parsed.allowlist, undefined);
});

test('CLI --help : usage affiché, code 0', () => {
  const r = spawnSync('node', [REFUS, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage/);
  assert.match(r.stdout, /--transcriptions/);
});

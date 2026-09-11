'use strict';
// Correctifs de maintenance 1.10.1 (2026-09-11) : verrou immédiat au réveil (course wakeWaiters/finishLaunch),
// --reprendre après un lanceur mort, coût et numéro de session dans le prompt, journal du lanceur committé,
// courrier et faits de contexte injectés par context-watch, constat bloquant sans message (sleep-guard).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { makeRoot, runHook } = require('./unites-indexees-setup.js');
const spawnMod = require('../bin/holarch-spawn.js');
const { wakeWaiters, isLive, reprendreTaches, coutCumule, countSessions, commitJournalLanceur } = spawnMod;

const FAKE_CLAUDE = path.join(__dirname, 'fake-claude.js');
const SCENARIO = path.join(__dirname, 'scenarios', 'livraison-simple.json');
const SESSIONS_HEAD = '# Sessions\n\n| Date (UTC) | Instance | Session | Modèle / effort | Tours | Tokens (entrée / cache lu / cache écrit / sortie) | Coût USD | Durée | Fin | STATUS | Réveil (car. système / utilisateur) | Contexte (départ / max) |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n';
const row = (inst, cout) => `| 2026-09-11T10:00:00Z | ${inst} | ${crypto.randomUUID()} | claude-sonnet-5/high | 10 | 1 / 2 / 3 / 4 | ${cout} | 1m | success | WORKING | 100 / 100 | 60000 / 90000 |\n`;
function statusReveil(etat, note, reveil) {
  return `# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | ${etat} |\n| Depuis | 2026-09-11T00:00:00Z |\n| Posé par | soi |\n| Note | ${note} |\n| Réveil | ${reveil} |\n`;
}
function withFake(fn) {
  const before = { c: process.env.HOLARCH_FAKE_CLAUDE, s: process.env.HOLARCH_FAKE_SCENARIO };
  process.env.HOLARCH_FAKE_CLAUDE = FAKE_CLAUDE; process.env.HOLARCH_FAKE_SCENARIO = SCENARIO;
  try { return fn(); } finally {
    if (before.c === undefined) delete process.env.HOLARCH_FAKE_CLAUDE; else process.env.HOLARCH_FAKE_CLAUDE = before.c;
    if (before.s === undefined) delete process.env.HOLARCH_FAKE_SCENARIO; else process.env.HOLARCH_FAKE_SCENARIO = before.s;
    try { fs.unlinkSync(`${SCENARIO}.attempt`); } catch (_) { /* rien */ }
  }
}
function tuer(pid) { try { process.kill(pid, 'SIGTERM'); } catch (_) { /* déjà fini */ } }

test('réveil : le verrou de vivacité est posé immédiatement, une seconde évaluation ne relance pas', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'mission', 'concepteur', 'STATUS.md'), statusReveil('WAITING_CHILDREN', '', 'fichier:mission/.pret'));
  fs.writeFileSync(path.join(root, 'mission', '.pret'), 'ok');
  withFake(() => {
    const premier = wakeWaiters(root, '--reveil');
    assert.equal(premier.length, 1, JSON.stringify(premier));
    assert.equal(isLive(root, 'concepteur'), true, 'verrou attendu tout de suite après le réveil');
    const second = wakeWaiters(root, '--reveil');
    assert.equal(second.length, 0, 'un réveillé encore vivant ne doit pas être relancé');
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'mission', '.holarch', 'live', 'concepteur.json'), 'utf8'));
    assert.ok(lock.pid > 0);
    tuer(lock.pid);
  });
});

test('--reprendre : une tâche « running » au pid mort est close et son instance en hibernation propre relancée', () => {
  const root = makeRoot();
  const tasks = path.join(root, 'mission', '.holarch', 'tasks');
  fs.mkdirSync(tasks, { recursive: true });
  fs.writeFileSync(path.join(tasks, 'concepteur-1.json'), JSON.stringify({ id: 'concepteur-1', chemin: 'concepteur', pid: 4194303, startedAt: '2026-09-11T00:00:00Z', state: 'running', parent: 'utilisateur', opts: {} }));
  fs.writeFileSync(path.join(root, 'mission', 'concepteur', 'STATUS.md'), statusReveil('WORKING', 'hibernation volontaire (contexte)', '—'));
  withFake(() => {
    const r = reprendreTaches(root);
    assert.equal(r.relancees.length, 1, r.lignes.join('\n'));
    assert.match(r.lignes[0], /relancée en détaché/);
    const close = JSON.parse(fs.readFileSync(path.join(tasks, 'concepteur-1.json'), 'utf8'));
    assert.equal(close.state, 'failed');
    const nouvelles = fs.readdirSync(tasks).filter((f) => f.endsWith('.json') && f !== 'concepteur-1.json');
    assert.equal(nouvelles.length, 1);
    const r2 = reprendreTaches(root);
    assert.equal(r2.relancees.length, 0, 'idempotent : rien à relancer tant que la nouvelle tâche vit');
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'mission', '.holarch', 'live', 'concepteur.json'), 'utf8'));
    tuer(lock.pid);
  });
});

test('--reprendre : une instance DELIVERED ou en arrêt demandé n\'est pas relancée', () => {
  const root = makeRoot();
  const tasks = path.join(root, 'mission', '.holarch', 'tasks');
  fs.mkdirSync(tasks, { recursive: true });
  fs.writeFileSync(path.join(tasks, 'concepteur-2.json'), JSON.stringify({ id: 'concepteur-2', chemin: 'concepteur', pid: 4194303, state: 'running' }));
  fs.writeFileSync(path.join(root, 'mission', 'concepteur', 'STATUS.md'), statusReveil('WORKING', 'hibernation volontaire (arrêt demandé)', '—'));
  const r = reprendreTaches(root);
  assert.equal(r.relancees.length, 0);
  assert.match(r.lignes[0], /non relancée/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tasks, 'concepteur-2.json'), 'utf8')).state, 'failed');
});

test('coût cumulé et sessions jouées : lus dans registry/SESSIONS.md par instance', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'mission', 'registry', 'SESSIONS.md'), SESSIONS_HEAD + row('concepteur', '1.5') + row('concepteur/enfant', '9') + row('concepteur', '2.25'));
  assert.equal(countSessions(root, 'concepteur'), 2);
  assert.equal(coutCumule(root, 'concepteur'), 3.75);
  assert.equal(coutCumule(root, 'concepteur/personne'), 0);
});

test('journal du lanceur : SESSIONS.md et REVEILS.md non committés sont committés sous [harnais]', () => {
  const root = makeRoot();
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const g = (args) => spawnSync('git', ['-C', root, '-c', 'gc.auto=0', ...args], { encoding: 'utf8', env });
  g(['init', '-q']); g(['add', '-A']); g(['commit', '-q', '-m', 'init']);
  assert.equal(commitJournalLanceur(root, 'concepteur'), false, 'rien à committer');
  fs.writeFileSync(path.join(root, 'mission', 'registry', 'SESSIONS.md'), SESSIONS_HEAD + row('concepteur', '1'));
  assert.equal(commitJournalLanceur(root, 'concepteur'), true);
  assert.match(g(['log', '-1', '--format=%s']).stdout, /^\[harnais\] journal des sessions et réveils \(concepteur\)/);
  assert.equal(g(['status', '--porcelain']).stdout.trim(), '');
});

function transcript(root, tokens) {
  const p = path.join(root, `t-${tokens}.jsonl`);
  fs.writeFileSync(p, JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, cache_read_input_tokens: tokens - 10, cache_creation_input_tokens: 0, output_tokens: 5 } } }) + '\n');
  return p;
}
function watch(root, sid, transcriptPath) {
  return runHook('context-watch', { session_id: sid, cwd: root, tool_name: 'Read', tool_input: {}, transcript_path: transcriptPath }, { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur', HOLARCH_CONTEXT_LIMIT: '250000' });
}
const ctxOf = (o) => (o.hookSpecificOutput || {}).additionalContext || '';

test('context-watch : fait de contexte par palier de 50k sous le seuil, courrier arrivé en cours de session', () => {
  const root = makeRoot();
  const sid = crypto.randomUUID();
  const t60 = transcript(root, 60000);
  const a = watch(root, sid, t60);
  assert.match(ctxOf(a), /\[HOLARCH · contexte\] ~60k tokens sur un seuil de 250k/);
  assert.doesNotMatch(ctxOf(a), /courrier/);
  assert.deepEqual(watch(root, sid, t60), {}, 'même palier, pas de courrier : silence');
  fs.appendFileSync(path.join(root, 'mission', 'concepteur', 'INBOX.md'), '\n---\nid: MSG-utilisateur-042\nfrom: utilisateur\nto: concepteur\ntype: TASK\nref: —\ndate: 2026-09-11T12:00:00Z\norigine: utilisateur\n---\nConsigne.\n');
  const c = watch(root, sid, t60);
  assert.match(ctxOf(c), /\[HOLARCH · courrier\] 1 message\(s\)/);
  assert.match(ctxOf(c), /MSG-utilisateur-042 \(TASK de utilisateur\)/);
  assert.deepEqual(watch(root, sid, t60), {}, 'courrier déjà signalé');
  const d = watch(root, sid, transcript(root, 130000));
  assert.match(ctxOf(d), /~130k tokens/);
  const e = watch(root, sid, transcript(root, 300000));
  assert.match(ctxOf(e), /budget de contexte/);
});

test('sleep-guard : un constat « impossible » sans BLOCKER bloque, un message envoyé ou « constat non bloquant » libère', () => {
  const root = makeRoot();
  const instance = 'concepteur/enfant';
  const base = path.join(root, 'mission', instance);
  fs.writeFileSync(path.join(base, 'STATUS.md'), statusReveil('WORKING', 'hibernation volontaire (contexte)', '—'));
  fs.writeFileSync(path.join(base, 'JOURNAL.md'), '# Journal\n\n## Session 1\nÉcriture impossible sous framework/, je contourne.\n');
  const env = { HOLARCH_ROOT: root, HOLARCH_INSTANCE: instance, HOLARCH_COMMIT: 'non' };
  const sid = crypto.randomUUID();
  const bloque = runHook('sleep-guard', { session_id: sid, cwd: root }, env);
  assert.equal(bloque.decision, 'block', JSON.stringify(bloque));
  assert.match(bloque.reason, /sans BLOCKER, CLARIFICATION ni PROPOSAL/);
  const jour = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(path.join(root, 'mission', 'concepteur', 'INBOX.md'), `\n---\nid: MSG-enfant-001\nfrom: ${instance}\nto: concepteur\ntype: BLOCKER\nref: —\ndate: ${jour}T12:00:00Z\norigine: soi\n---\nImpossible d'écrire.\n`);
  assert.deepEqual(runHook('sleep-guard', { session_id: crypto.randomUUID(), cwd: root }, env), {});
  fs.writeFileSync(path.join(root, 'mission', 'concepteur', 'INBOX.md'), '# Boîte\n');
  fs.appendFileSync(path.join(base, 'JOURNAL.md'), 'constat non bloquant : le livrable va sous shared/.\n');
  assert.deepEqual(runHook('sleep-guard', { session_id: crypto.randomUUID(), cwd: root }, env), {});
});

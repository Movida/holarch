'use strict';
// Tests du collecteur sur une mission fabriquée dans un dossier temporaire (git réel, worktree réel, transcriptions
// fabriquées, `ps` injecté). Aucun LLM, aucune écriture hors du dossier temporaire.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const collecte = require('./collecte.js');
const observe = require('./observe.js');

const ENV_GIT = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 't@t', HOME: os.tmpdir(), GIT_CONFIG_GLOBAL: '/dev/null' });
function git(cwd, args) { const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: ENV_GIT }); if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`); return r.stdout; }
function ecrire(root, rel, contenu) { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, contenu); }

const STATUS = (etat, note, reveil, depuis) => `# Statut\n\n| Champ | Valeur |\n|---|---|\n| État | ${etat} |\n| Depuis | ${depuis || '2026-09-11T10:00:00Z'} |\n| Posé par | soi |\n| Note | ${note || ''} |\n| Réveil | ${reveil || '—'} |\n`;
const FICHE = (chemin, statut) => `# ${chemin}\n| Champ | Valeur |\n|---|---|\n| Statut | ${statut} |\n| Budget alloué / consommé | 3 / 1 |\n| Profil | conception |\n`;
const MSG = (id, from, to, type, ref, date) => `\n---\nid: ${id}\nfrom: ${from}\nto: ${to}\ntype: ${type}\nref: ${ref || '—'}\ndate: ${date || '2026-09-11T11:00:00Z'}\n---\ncorps de ${id}\n`;
const SESSIONS = `# Sessions\n\n| Date (UTC) | Instance | Session | Modèle / effort | Tours | Tokens (entrée / cache lu / cache écrit / sortie) | Coût USD | Durée | Fin | STATUS | Réveil (car. système / utilisateur) | Contexte (départ / max) |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n| 2026-09-11T10:30:00Z | concepteur | s-1111 | opus/high | 40 | 10 / 20 / 30 / 40 | 1.2500 | 5 min | end_turn | WORKING | 1000 / 2000 | 40000 / 90000 |\n| 2026-09-11T10:50:00Z | concepteur/enfant | s-2222 | sonnet/medium | 20 | 1 / 2 / 3 / 4 | 0.5000 | 3 min | end_turn | WORKING | 1 / 2 | 30000 / 50000 |\n`;

/** Mission fabriquée : racine `concepteur` sur main, enfant `concepteur/enfant` sur sa branche, incarné dans un worktree. */
function fabriquer() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-observe-'));
  ecrire(root, 'framework/KERNEL.md', '# KERNEL\n');
  ecrire(root, 'framework/CONFIG.md', '# Configuration — mission : test-observe\n\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n| budget_usd_par_session | 8 |\n| seuil_contexte_tokens | 240000 |\n| budget_instances_total | 5 |\n');
  ecrire(root, 'mission/OBJECTIVE.md', '# Objectif — mission `test-observe`\n');
  ecrire(root, 'mission/.holarch/.gitignore', '*\n');
  ecrire(root, 'mission/concepteur/STATUS.md', STATUS('WORKING', 'Session n° 1'));
  ecrire(root, 'mission/concepteur/INBOX.md', '# INBOX\n');
  ecrire(root, 'mission/concepteur/OUTBOX.md', '# OUTBOX\n');
  ecrire(root, 'mission/concepteur/memoire/INDEX.md', '| Unité | Date | Résultat | Critère | Fiche |\n|---|---|---|---|---|\n| U1 | 2026-09-11T10:10:00Z | PASS | bootstrap | U1-b.md |\n| U2 | 2026-09-11T10:20:00Z | FAIL | orientation | U2-o.md |\n');
  ecrire(root, 'mission/registry/ORG.md', '# Organigramme\n\n- `concepteur` — WORKING — racine (parent : utilisateur) — budget 5\n  - `enfant` — INIT — volet 1\n');
  ecrire(root, 'mission/registry/instances/concepteur.md', FICHE('concepteur', 'WORKING'));
  ecrire(root, 'mission/registry/SESSIONS.md', SESSIONS);
  ecrire(root, 'mission/concepteur/enfant/STATUS.md', STATUS('INIT', 'Instance créée au spawn'));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['add', '-A']); git(root, ['commit', '-q', '-m', '[bootstrap] mission initialisée']);
  git(root, ['commit', '-q', '--allow-empty', '-m', '[concepteur] U1 : bootstrap']);
  git(root, ['commit', '-q', '--allow-empty', '-m', '[concepteur] U2 : orientation']);
  // branche de l'enfant + worktree, où son STATUS passe à WORKING
  git(root, ['branch', 'holarch/concepteur-enfant']);
  const wt = path.join(root, 'mission', '.holarch', 'worktrees', 'concepteur-enfant');
  git(root, ['worktree', 'add', '-q', wt, 'holarch/concepteur-enfant']);
  ecrire(wt, 'mission/concepteur/enfant/STATUS.md', STATUS('WORKING', 'Session n° 1 : volet 1'));
  ecrire(wt, 'mission/registry/instances/concepteur-enfant.md', FICHE('concepteur/enfant', 'WORKING'));
  git(wt, ['add', '-A']); git(wt, ['commit', '-q', '-m', '[concepteur/enfant] U1 : volet 1']);
  // transcriptions : un dossier par cwd (slug Claude Code), forcé ici par deps
  const tdir = path.join(root, 'transcriptions'); fs.mkdirSync(tdir, { recursive: true });
  return { root, wt, tdir };
}
function nettoyer(root) { try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* ignore */ } }
function deps(f, sur) { return Object.assign({ ps: () => '', transcriptionsDir: () => f.tdir, pidVivant: (pid) => pid === process.pid }, sur || {}); }
const ligneAssistant = (ctx) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 2, cache_read_input_tokens: ctx - 2, cache_creation_input_tokens: 0, output_tokens: 10 } } });
const ligneUser = (contenu) => JSON.stringify({ type: 'user', message: { role: 'user', content: contenu } });

test('instances : racine dans l\'arbre, enfant dans son worktree, états et unités', () => {
  const f = fabriquer();
  try {
    const e = collecte.collecter(f.root, deps(f));
    assert.equal(e.mission.nom, 'test-observe');
    assert.deepEqual(e.instances.map((i) => [i.chemin, i.source, i.etat]), [['concepteur', 'arbre', 'WORKING'], ['concepteur/enfant', 'worktree', 'WORKING']]);
    const r = e.instances[0];
    assert.equal(r.unitesPass, 1); assert.equal(r.unites.length, 2); assert.equal(r.git.commits, 2);
    assert.equal(r.sessions.n, 1); assert.equal(r.sessions.usd, 1.25);
    assert.equal(e.sessions.total.usd, 1.75); assert.equal(e.sessions.total.tours, 60);
    const en = e.instances[1];
    assert.equal(en.git.worktree, f.wt); assert.equal(en.git.commits, 1); assert.equal(en.org, 'INIT'); assert.equal(en.fiche.statut, 'WORKING');
    assert.ok(e.anomalies.some((a) => a.code === 'org-en-retard' && a.chemin === 'concepteur/enfant'));
  } finally { nettoyer(f.root); }
});

test('WORKING sans verrou ni processus = anomalie ; verrou au pid vivant = session vivante ; verrou au pid mort = périmé', () => {
  const f = fabriquer();
  try {
    let e = collecte.collecter(f.root, deps(f));
    assert.ok(e.anomalies.some((a) => a.code === 'working-sans-session' && a.chemin === 'concepteur'));
    assert.match(e.instances[0].effectif, /aucune session vivante/);
    ecrire(f.root, 'mission/.holarch/live/concepteur.json', JSON.stringify({ pid: process.pid, startedAt: '2026-09-11T10:00:00Z', attempt: 1 }));
    ecrire(f.root, 'mission/.holarch/live/concepteur.contexte.json', JSON.stringify({ session_id: 's-vive', depart: 40000, max: 70000, dernier: 65000, tours: 12 }));
    fs.writeFileSync(path.join(f.tdir, 's-vive.jsonl'), `${ligneUser('Tu incarnes l\'instance `concepteur` (profondeur 1)')}\n${ligneAssistant(50000)}\n${ligneAssistant(72000)}\n`);
    e = collecte.collecter(f.root, deps(f));
    const r = e.instances[0];
    assert.equal(r.live.vivant, true);
    assert.equal(r.transcription.contexte, 72000);
    assert.match(r.effectif, /session vivante .*72k tokens/);
    assert.ok(!e.anomalies.some((a) => a.code === 'working-sans-session' && a.chemin === 'concepteur'), 'la racine vivante n\'est plus sans session (l\'enfant du fixture, lui, l\'est)');
    assert.ok(!e.anomalies.some((a) => a.code === 'session-sans-journal' && a.chemin === 'concepteur'), 'une session vivante n\'est pas « sans journal »');
    ecrire(f.root, 'mission/.holarch/live/concepteur.json', JSON.stringify({ pid: 999999, startedAt: '2026-09-11T10:00:00Z', attempt: 1 }));
    e = collecte.collecter(f.root, deps(f));
    assert.ok(e.anomalies.some((a) => a.code === 'verrou-perime' && a.chemin === 'concepteur'));
  } finally { nettoyer(f.root); }
});

test('processus : `claude -p … -n holarch:<chemin>` rend l\'instance vivante ; enfant synchrone sans fiche de tâche ; sessions interactives ignorées', () => {
  const f = fabriquer();
  try {
    const ps = [
      '100 1 300 /usr/bin/node /x/framework/bin/holarch-spawn.js concepteur',
      '101 100 299 claude -p --model opus -n holarch:concepteur --tools Read',
      '102 101 50 /bin/bash -c source snapshot && node framework/bin/holarch-spawn.js concepteur/enfant',
      '103 102 50 node framework/bin/holarch-spawn.js concepteur/enfant',
      '104 103 49 claude -p --model sonnet -n holarch:concepteur/enfant',
      '200 1 1000 claude --replay-user-messages',
      '201 1 5 grep claude -p',
    ].join('\n');
    const e = collecte.collecter(f.root, deps(f, { ps: () => ps }));
    assert.deepEqual(e.processus.map((p) => [p.pid, p.role, p.chemin]), [[100, 'lanceur', 'concepteur'], [101, 'claude', 'concepteur'], [103, 'lanceur', 'concepteur/enfant'], [104, 'claude', 'concepteur/enfant']]);
    assert.equal(e.instances[0].live.pidClaude, 101);
    assert.equal(e.instances[1].live.pidClaude, 104);
    assert.equal(e.instances[1].live.tache, null);
    assert.ok(e.anomalies.every((a) => a.code !== 'working-sans-session'));
  } finally { nettoyer(f.root); }
});

test('messages : PROPOSAL à utilisateur sans RESPONSE attend le mainteneur ; avec RESPONSE, non ; CLARIFICATION entre instances sans réponse listée', () => {
  const f = fabriquer();
  try {
    ecrire(f.root, 'mission/concepteur/OUTBOX.md', `# OUTBOX\n${MSG('MSG-c-1', 'concepteur', 'utilisateur', 'PROPOSAL')}`);
    ecrire(f.wt, 'mission/concepteur/INBOX.md', `# INBOX\n${MSG('MSG-e-1', 'concepteur/enfant', 'concepteur', 'CLARIFICATION')}`);
    ecrire(f.wt, 'mission/concepteur/enfant/OUTBOX.md', `# OUTBOX\n${MSG('MSG-e-1', 'concepteur/enfant', 'concepteur', 'CLARIFICATION')}`);
    let e = collecte.collecter(f.root, deps(f));
    assert.deepEqual(e.messagesPourMainteneur.map((m) => [m.id, m.type, m.repondu]), [['MSG-c-1', 'PROPOSAL', false]]);
    assert.ok(e.anomalies.some((a) => a.code === 'attend-mainteneur'));
    assert.deepEqual(e.messagesSansReponse.map((m) => m.id), ['MSG-e-1']);
    ecrire(f.root, 'mission/concepteur/INBOX.md', `# INBOX\n${MSG('MSG-u-1', 'utilisateur', 'concepteur', 'RESPONSE', 'MSG-c-1')}`);
    e = collecte.collecter(f.root, deps(f));
    assert.equal(e.messagesPourMainteneur.filter((m) => !m.repondu).length, 0);
    assert.ok(!e.anomalies.some((a) => a.code === 'attend-mainteneur'));
  } finally { nettoyer(f.root); }
});

test('réveil : WAITING_CHILDREN avec condition satisfaite et aucune session = réveil attendu', () => {
  const f = fabriquer();
  try {
    ecrire(f.root, 'mission/concepteur/STATUS.md', STATUS('WAITING_CHILDREN', 'hibernation', 'enfant:enfant:DELIVERED'));
    let e = collecte.collecter(f.root, deps(f));
    assert.equal(e.instances[0].reveilEval.satisfait, false);
    assert.match(e.instances[0].effectif, /non satisfaite/);
    ecrire(f.wt, 'mission/concepteur/enfant/STATUS.md', STATUS('DELIVERED', 'livré'));
    e = collecte.collecter(f.root, deps(f));
    assert.equal(e.instances[0].reveilEval.satisfait, true);
    assert.ok(e.anomalies.some((a) => a.code === 'reveil-attendu' && a.chemin === 'concepteur'));
  } finally { nettoyer(f.root); }
});

test('arbre principal hors main = alerte ; fichiers du lanceur non committés = info', () => {
  const f = fabriquer();
  try {
    fs.appendFileSync(path.join(f.root, 'mission/registry/SESSIONS.md'), '| 2026-09-11T11:00:00Z | concepteur | s-3333 | opus/high | 5 | 1 / 2 / 3 / 4 | 0.1000 | 1 min | end_turn | WORKING | 1 / 2 | — / — |\n');
    let e = collecte.collecter(f.root, deps(f));
    assert.ok(e.anomalies.some((a) => a.code === 'journal-lanceur-non-committe'));
    assert.deepEqual(e.git.fichiersLanceur, ['mission/registry/SESSIONS.md']);
    git(f.root, ['switch', '-q', '-c', 'holarch/concepteur-autre']);
    e = collecte.collecter(f.root, deps(f));
    assert.ok(e.anomalies.some((a) => a.code === 'branche-principale'));
  } finally { nettoyer(f.root); }
});

test('transcription d\'instance sans ligne SESSIONS.md = session tuée, tours et pic comptés ; transcription interactive ignorée', () => {
  const f = fabriquer();
  try {
    fs.writeFileSync(path.join(f.tdir, 's-tuee.jsonl'), `${ligneUser('Tu incarnes l\'instance `concepteur` (profondeur 1, profil conception).')}\n${ligneAssistant(45000)}\n${ligneAssistant(80000)}\n${ligneAssistant(60000)}\n`);
    fs.writeFileSync(path.join(f.tdir, 's-boot.jsonl'), `${ligneUser('Tu es la première session de cette mission. Exécute la procédure de framework/BOOTSTRAP.md (fournie dans ton prompt système)')}\n${ligneAssistant(30000)}\n`);
    fs.writeFileSync(path.join(f.tdir, 's-maint.jsonl'), `${ligneUser('Si ton prompt commence par « Tu incarnes l\'instance », tu es une instance')}\n${ligneAssistant(99000)}\n`);
    fs.writeFileSync(path.join(f.tdir, 's-1111.jsonl'), `${ligneUser('Tu incarnes l\'instance `concepteur`')}\n${ligneAssistant(1000)}\n`); // journalisée : pas une anomalie
    const e = collecte.collecter(f.root, deps(f));
    const sj = e.transcriptions.sansJournal.sort((a, b) => a.session.localeCompare(b.session));
    assert.deepEqual(sj.map((t) => [t.session, t.chemin, t.tours, t.pic]), [['s-boot', 'bootstrap', 1, 30000], ['s-tuee', 'concepteur', 3, 80000]]);
    assert.equal(e.anomalies.filter((a) => a.code === 'session-sans-journal').length, 2);
  } finally { nettoyer(f.root); }
});

test('tâches détachées : running au pid mort = alerte ; ré-incarnations arrêtées dans le log = alerte', () => {
  const f = fabriquer();
  try {
    ecrire(f.root, 'mission/.holarch/tasks/concepteur-enfant-1.json', JSON.stringify({ id: 'concepteur-enfant-1', chemin: 'concepteur/enfant', pid: 999999, startedAt: '2026-09-11T10:00:00Z', state: 'running', parent: 'concepteur' }));
    ecrire(f.root, 'mission/.holarch/tasks/concepteur-enfant-1.log', 'HOLARCH ▸ concepteur/enfant ▸ ré-incarnations arrêtées (plafond 3 sessions)\n');
    const e = collecte.collecter(f.root, deps(f));
    assert.ok(e.anomalies.some((a) => a.code === 'tache-pid-mort'));
    assert.ok(e.anomalies.some((a) => a.code === 'reincarnations-arretees'));
    assert.equal(e.taches[0].vivant, false);
  } finally { nettoyer(f.root); }
});

test('lecture seule : rien sous mission/ n\'est modifié par une collecte', () => {
  const f = fabriquer();
  try {
    const photo = () => { const out = []; const walk = (d) => { for (const en of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, en.name); if (en.isDirectory()) { if (en.name !== '.git') walk(p); } else out.push(`${path.relative(f.root, p)}:${fs.statSync(p).mtimeMs}:${fs.statSync(p).size}`); } }; walk(path.join(f.root, 'mission')); return out.sort().join('\n'); };
    const avant = photo();
    collecte.collecter(f.root, deps(f));
    collecte.collecter(f.root, deps(f));
    assert.equal(photo(), avant);
  } finally { nettoyer(f.root); }
});

test('observe.js : formatage texte, résumé stable, différence, dossiers observés, exécutable --json', () => {
  const f = fabriquer();
  try {
    const e = collecte.collecter(f.root, deps(f));
    const texte = observe.formater(e);
    assert.match(texte, /mission test-observe/); assert.match(texte, /concepteur\s+WORKING/); assert.match(texte, /enfant\s+WORKING · session vivante|enfant\s+WORKING · aucune/);
    assert.match(texte, /1\.75 USD/);
    const r1 = observe.resumer(e);
    ecrire(f.wt, 'mission/concepteur/enfant/STATUS.md', STATUS('DELIVERED', 'livré'));
    const r2 = observe.resumer(collecte.collecter(f.root, deps(f)));
    const dlt = observe.difference(r1, r2);
    assert.ok(dlt.ajoutees.some((x) => /concepteur\/enfant DELIVERED/.test(x)));
    assert.ok(dlt.retirees.some((x) => /concepteur\/enfant WORKING/.test(x)));
    const dossiers = observe.dossiersAObserver(f.root, e);
    assert.ok(dossiers.includes(path.join(f.root, 'mission', '.holarch', 'live')));
    assert.ok(dossiers.includes(path.join(f.wt, 'mission', 'concepteur', 'enfant')));
    const r = spawnSync(process.execPath, [path.join(__dirname, 'observe.js'), '--root', f.root, '--json'], { encoding: 'utf8', env: Object.assign({}, process.env, { HOLARCH_OBSERVE_PS: '', HOLARCH_OBSERVE_TRANSCRIPTS: f.tdir }) });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.mission.nom, 'test-observe'); assert.equal(j.instances.length, 2);
    const t = spawnSync(process.execPath, [path.join(__dirname, 'observe.js'), '--root', f.root], { encoding: 'utf8', env: Object.assign({}, process.env, { HOLARCH_OBSERVE_PS: '', HOLARCH_OBSERVE_TRANSCRIPTS: f.tdir }) });
    assert.equal(t.status, 0); assert.match(t.stdout, /Anomalies/);
  } finally { nettoyer(f.root); }
});

test('parseurs : ORG indenté, SESSIONS, STATUS, fiche, worktrees porcelain', () => {
  assert.deepEqual(collecte.parseOrg('- `concepteur` — WORKING — racine\n  - `a` — INIT — x\n    - `b` — READY — y\n  - `c` — DELIVERED — z\n').map((o) => [o.chemin, o.etat]), [['concepteur', 'WORKING'], ['concepteur/a', 'INIT'], ['concepteur/a/b', 'READY'], ['concepteur/c', 'DELIVERED']]);
  const s = collecte.parseSessions(SESSIONS);
  assert.equal(s.length, 2); assert.equal(s[0].usd, 1.25); assert.equal(s[1].instance, 'concepteur/enfant'); assert.equal(s[0].tokens.cacheLu, 20);
  assert.deepEqual(collecte.parseStatus(STATUS('BLOCKED', 'n', 'message:RESPONSE')), { etat: 'BLOCKED', depuis: '2026-09-11T10:00:00Z', posePar: 'soi', note: 'n', reveil: 'message:RESPONSE' });
  assert.equal(collecte.parseStatus(STATUS('WORKING')).reveil, '');
  assert.deepEqual(collecte.parseFiche(FICHE('x', 'INIT')), { statut: 'INIT', budgetAlloue: 3, budgetConsomme: 1, profil: 'conception', effort: '' });
  assert.deepEqual(collecte.parseWorktrees('worktree /a\nHEAD 1234567890\nbranch refs/heads/main\n\nworktree /b\nHEAD abcdef0123\nbranch refs/heads/holarch/x\n'), [{ chemin: '/a', head: '1234567', branche: 'main' }, { chemin: '/b', head: 'abcdef0', branche: 'holarch/x' }]);
  assert.equal(collecte.instanceDeTranscription('{"type":"user","message":{"content":"Tu incarnes l\'instance `a/b` (profondeur 2)"}}'), 'a/b');
  assert.equal(collecte.instanceDeTranscription('Si ton prompt commence par « Tu incarnes l\'instance »'), '');
});

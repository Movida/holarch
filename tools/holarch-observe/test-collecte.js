'use strict';
// Tests du collecteur sur une mission fabriquée dans un dossier temporaire (git réel, worktree réel, transcriptions
// fabriquées, `ps` injecté). Aucun LLM, aucune écriture hors du dossier temporaire.
//
// U7 (chantier 16, §18.1-18.3) : ce fichier tourne depuis ce paquet (`cible-tools/tools/holarch-observe/`) comme
// après application dans `tools/holarch-observe/` : `collecte.js` voisin ; `observe.js` voisin (livré par ce paquet
// depuis U21), sinon celui du dépôt (remontée jusqu'à `framework/KERNEL.md`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const collecte = require('./collecte.js');
const OBSERVE_JS = (() => {
  if (fs.existsSync(path.join(__dirname, 'observe.js'))) return path.join(__dirname, 'observe.js');
  let d = __dirname;
  while (!fs.existsSync(path.join(d, 'framework', 'KERNEL.md'))) { const p = path.dirname(d); if (p === d) throw new Error('observe.js introuvable'); d = p; }
  return path.join(d, 'tools', 'holarch-observe', 'observe.js');
})();
const observe = require(OBSERVE_JS);

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
function deps(f, sur) { return Object.assign({ ps: () => '', transcriptionsDir: () => f.tdir, pidVivant: (pid) => pid === process.pid, processus: () => [], chargeDir: () => path.join(f.root, 'charge-vide') }, sur || {}); }
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

test("livrable-sans-rejeu : enfant DELIVERED avec un DELIVERABLE en OUTBOX sans fichier de contrôle postérieur = anomalie ; un fichier postérieur l'efface", () => {
  const f = fabriquer();
  try {
    ecrire(f.wt, 'mission/concepteur/enfant/STATUS.md', STATUS('DELIVERED', 'livré'));
    ecrire(f.wt, 'mission/concepteur/enfant/OUTBOX.md', `# OUTBOX\n${MSG('MSG-e-2', 'concepteur/enfant', 'concepteur', 'DELIVERABLE', '—', '2026-09-11T12:00:00Z')}`);
    let e = collecte.collecter(f.root, deps(f));
    assert.ok(e.anomalies.some((a) => a.code === 'livrable-sans-rejeu' && a.chemin === 'concepteur/enfant'), JSON.stringify(e.anomalies));
    ecrire(f.root, 'mission/.holarch/controles/concepteur-enfant-2026-09-11T13-00-00Z.json', JSON.stringify({ date: '2026-09-11T13:00:00Z' }));
    e = collecte.collecter(f.root, deps(f));
    assert.ok(!e.anomalies.some((a) => a.code === 'livrable-sans-rejeu'), JSON.stringify(e.anomalies.filter((a) => a.code === 'livrable-sans-rejeu')));
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
    // close depuis plus de trois minutes : anomalie ; une transcription fraîche (fin de session, ligne pas encore écrite) n'en est pas une
    // (l'horloge injectée avance de dix minutes : les transcriptions écrites à l'instant sont « vieilles », s-fraiche est datée du futur)
    const plusTard = new Date(Date.now() + 10 * 60 * 1000);
    fs.writeFileSync(path.join(f.tdir, 's-fraiche.jsonl'), `${ligneUser('Tu incarnes l\'instance `concepteur`')}\n${ligneAssistant(2000)}\n`);
    fs.utimesSync(path.join(f.tdir, 's-fraiche.jsonl'), plusTard, plusTard);
    const e = collecte.collecter(f.root, deps(f, { now: () => plusTard }));
    assert.ok(e.transcriptions.sansJournal.some((t) => t.session === 's-fraiche' && t.recente === true), 'transcription fraîche listée, marquée récente');
    assert.ok(!e.anomalies.some((a) => a.code === 'session-sans-journal' && /s-fraich/.test(a.texte)), 'pas d\'alerte pour une transcription fraîche');
    e.transcriptions.sansJournal = e.transcriptions.sansJournal.filter((t) => t.session !== 's-fraiche');
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
    const r = spawnSync(process.execPath, [OBSERVE_JS, '--root', f.root, '--json'], { encoding: 'utf8', env: Object.assign({}, process.env, { HOLARCH_OBSERVE_PS: '', HOLARCH_OBSERVE_TRANSCRIPTS: f.tdir }) });
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.equal(j.mission.nom, 'test-observe'); assert.equal(j.instances.length, 2);
    const t = spawnSync(process.execPath, [OBSERVE_JS, '--root', f.root], { encoding: 'utf8', env: Object.assign({}, process.env, { HOLARCH_OBSERVE_PS: '', HOLARCH_OBSERVE_TRANSCRIPTS: f.tdir }) });
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

test('observe --mainteneur : ne garde d\'un résumé que ce qui appelle un geste du mainteneur', () => {
  const { pourMainteneur } = observe;
  const r = ['arbre main', 'concepteur WAITING_CHILDREN · attend U7/7 c12', 'concepteur/a WORKING · session vivante U3/5 c4',
    'concepteur/b DELIVERED U6/6 c9', 'concepteur/c FAILED U1/4 c1', 'sessions 9 42.69 USD', 'tâche x-1 running', 'tâche x-2 failed',
    'tâche x-3 done (exit 2)', 'tâche x-4 done ARRÊT', 'mainteneur CLARIFICATION MSG-concepteur-2', 'sans réponse TASK MSG-1 → concepteur/a',
    'réveil 2026-09-11T20:00:00Z concepteur', '⚠ tache-pid-mort concepteur/a', 'ℹ inbox-non-fusionnee concepteur/a', 'concepteur DELIVERED U8/8 c14'];
  assert.deepEqual(pourMainteneur(r), ['concepteur/c FAILED U1/4 c1', 'tâche x-2 failed', 'tâche x-3 done (exit 2)', 'tâche x-4 done ARRÊT',
    'mainteneur CLARIFICATION MSG-concepteur-2', '⚠ tache-pid-mort concepteur/a', 'concepteur DELIVERED U8/8 c14']);
});

test('sans-progres : ≥ 4 sessions et aucune unité close = alerte ; session-longue : session vivante ≥ 45 min', () => {
  const f = fabriquer();
  try {
    const avantUsd = (collecte.collecter(f.root, deps(f)).sessions.parInstance['concepteur/enfant'] || { usd: 0 }).usd;
    const ligne = (i) => `| 2026-09-12T1${i}:00:00Z | concepteur/enfant | s-e${i} | sonnet/medium | 60 | 10 / 20 / 0 / 5 | ≈ 0.2000 | 8 min | success | WORKING | 100 / 200 | 40000 / 50000 |`;
    fs.appendFileSync(path.join(f.root, 'mission', 'registry', 'SESSIONS.md'), ['', ligne(0), ligne(1), ligne(2), ligne(3)].join('\n') + '\n');
    const e = collecte.collecter(f.root, deps(f));
    const a = e.anomalies.find((x) => x.code === 'sans-progres' && x.chemin === 'concepteur/enfant');
    assert.ok(a, 'alerte sans-progres attendue');
    assert.match(a.texte, /session\(s\).*aucune unité close.*--arret concepteur\/enfant/);
    assert.equal(a.niveau, 'alerte');
    assert.equal(e.sessions.parInstance['concepteur/enfant'].usd, Math.round((avantUsd + 0.8) * 10000) / 10000, 'les coûts « ≈ » (catalogue) sont sommés comme les autres');
    // Une session vivante de 50 min pour l'enfant : session-longue.
    const ps = `  1 /sbin/init\n ${process.pid} 1 3000 claude -p --model sonnet -n holarch:concepteur/enfant\n`;
    const e2 = collecte.collecter(f.root, deps(f, { ps: () => ps }));
    assert.ok(e2.anomalies.some((x) => x.code === 'session-longue' && x.chemin === 'concepteur/enfant'), JSON.stringify(e2.anomalies.map((x) => x.code)));
  } finally { nettoyer(f.root); }
});

// --------------------------------------------------------------------------------------- U7 (§18.1-18.3)

test('session-coupee-fusible : dernière ligne SESSIONS.md « coupée (fusible) » → alerte ; une ligne normale ultérieure l\'efface', () => {
  const f = fabriquer();
  try {
    let e = collecte.collecter(f.root, deps(f));
    assert.ok(!e.anomalies.some((a) => a.code === 'session-coupee-fusible'), 'fixture par défaut : dernière ligne end_turn, pas d\'anomalie');
    fs.appendFileSync(path.join(f.root, 'mission/registry/SESSIONS.md'), '| 2026-09-12T09:00:00Z | concepteur | s-4444 | opus/high | 10 | 1 / 2 / 3 / 4 | 0.3000 | 2 min | coupée (fusible) | WORKING | — / — | — / — |\n');
    e = collecte.collecter(f.root, deps(f));
    const a = e.anomalies.find((x) => x.code === 'session-coupee-fusible' && x.chemin === 'concepteur');
    assert.ok(a, JSON.stringify(e.anomalies));
    assert.equal(a.niveau, 'alerte');
    assert.equal(a.texte, 'session coupée par le fusible de budget, relancer.');
    // MSG-utilisateur-004 D : session déjà relancée (verrou live vivant) → l'alerte se tait.
    ecrire(f.root, 'mission/.holarch/live/concepteur.json', JSON.stringify({ pid: process.pid, startedAt: '2026-09-12T09:05:00Z', attempt: 1 }));
    e = collecte.collecter(f.root, deps(f));
    assert.ok(!e.anomalies.some((x) => x.code === 'session-coupee-fusible'), `relancée : ${JSON.stringify(e.anomalies.map((x) => x.code))}`);
    fs.unlinkSync(path.join(f.root, 'mission/.holarch/live/concepteur.json'));
    fs.appendFileSync(path.join(f.root, 'mission/registry/SESSIONS.md'), '| 2026-09-12T09:10:00Z | concepteur | s-5555 | opus/high | 10 | 1 / 2 / 3 / 4 | 0.3000 | 2 min | end_turn | WORKING | — / — | — / — |\n');
    e = collecte.collecter(f.root, deps(f));
    assert.ok(!e.anomalies.some((x) => x.code === 'session-coupee-fusible'), 'une ligne ultérieure normale efface l\'alerte : seule la dernière ligne compte');
  } finally { nettoyer(f.root); }
});

test('budget-au-seuil : session vivante avec ratio ≥ 0.8 ou ordre_a émis → info ; sans session vivante ou sous le seuil, aucune anomalie', () => {
  const f = fabriquer();
  try {
    let e = collecte.collecter(f.root, deps(f));
    assert.ok(!e.anomalies.some((a) => a.code === 'budget-au-seuil'), 'aucun fichier budget : rien');
    ecrire(f.root, 'mission/.holarch/live/concepteur.budget.json', JSON.stringify({ session_id: 's-b1', plafond: 8, depense: 6.4, ratio: 0.8, source: 'catalogue', ordre_a: null }));
    e = collecte.collecter(f.root, deps(f));
    assert.ok(!e.anomalies.some((a) => a.code === 'budget-au-seuil'), 'ratio au seuil mais pas de session vivante : rien');
    ecrire(f.root, 'mission/.holarch/live/concepteur.json', JSON.stringify({ pid: process.pid, startedAt: '2026-09-12T09:00:00Z', attempt: 1 }));
    e = collecte.collecter(f.root, deps(f));
    const a = e.anomalies.find((x) => x.code === 'budget-au-seuil' && x.chemin === 'concepteur');
    assert.ok(a, JSON.stringify(e.anomalies));
    assert.equal(a.niveau, 'info');
    assert.equal(a.texte, 'concepteur à 80% de son budget (6.4/8 USD)');
    ecrire(f.root, 'mission/.holarch/live/concepteur.budget.json', JSON.stringify({ session_id: 's-b1', plafond: 8, depense: 2, ratio: 0.25, source: 'catalogue', ordre_a: null }));
    e = collecte.collecter(f.root, deps(f));
    assert.ok(!e.anomalies.some((x) => x.code === 'budget-au-seuil'), 'ratio sous le seuil et pas d\'ordre_a : aucune anomalie');
    ecrire(f.root, 'mission/.holarch/live/concepteur.budget.json', JSON.stringify({ session_id: 's-b1', plafond: 8, depense: 2, ratio: 0.25, source: 'catalogue', ordre_a: 3 }));
    e = collecte.collecter(f.root, deps(f));
    assert.ok(e.anomalies.some((x) => x.code === 'budget-au-seuil' && x.chemin === 'concepteur'), 'ordre_a émis (nombre) déclenche l\'anomalie même sous 0.8');
  } finally { nettoyer(f.root); }
});

test('attente-limite : pid vivant → alerte avec heure UTC et motif ; pid mort → aucune anomalie', () => {
  const f = fabriquer();
  try {
    let e = collecte.collecter(f.root, deps(f));
    assert.ok(!e.anomalies.some((a) => a.code === 'attente-limite'), 'aucun fichier attente : rien');
    const pidMort = 2 ** 22 - 3;
    let vraimentMort = false;
    try { process.kill(pidMort, 0); } catch (err) { vraimentMort = err && err.code === 'ESRCH'; }
    assert.ok(vraimentMort, 'le pid choisi pour ce test doit être réellement mort sur cette machine');
    ecrire(f.root, 'mission/.holarch/live/concepteur.attente.json', JSON.stringify({ pid: pidMort, jusqua: '2026-09-12T14:30:00Z', motif: '429', tentative: 1 }));
    e = collecte.collecter(f.root, deps(f));
    assert.ok(!e.anomalies.some((a) => a.code === 'attente-limite'), 'pid mort : aucune anomalie');
    ecrire(f.root, 'mission/.holarch/live/concepteur.attente.json', JSON.stringify({ pid: process.pid, jusqua: '2026-09-12T14:30:00Z', motif: '429', tentative: 1 }));
    e = collecte.collecter(f.root, deps(f));
    const a = e.anomalies.find((x) => x.code === 'attente-limite' && x.chemin === 'concepteur');
    assert.ok(a, JSON.stringify(e.anomalies));
    assert.equal(a.niveau, 'alerte');
    assert.equal(a.texte, "concepteur attend la limite jusqu'à 14:30 (429)");
    // MSG-utilisateur-004, point 10 : pas de « relancer » (working-sans-session) pendant une attente vivante.
    assert.ok(!e.anomalies.some((x) => x.code === 'working-sans-session' && x.chemin === 'concepteur'), JSON.stringify(e.anomalies));
    assert.match(e.instances[0].effectif, /attente d'une limite 429/);
    // Point 6 : même pid vivant, starttime noté différent (pid réutilisé) → pas d'attente vivante.
    ecrire(f.root, 'mission/.holarch/live/concepteur.attente.json', JSON.stringify({ pid: process.pid, starttime: 'noté', jusqua: '2026-09-12T14:30:00Z', motif: '429', tentative: 1 }));
    e = collecte.collecter(f.root, deps(f, { starttimeDe: () => 'actuel' }));
    assert.ok(!e.anomalies.some((x) => x.code === 'attente-limite'), 'pid réutilisé : aucune attente-limite');
    e = collecte.collecter(f.root, deps(f, { starttimeDe: () => 'noté' }));
    assert.ok(e.anomalies.some((x) => x.code === 'attente-limite'), 'même starttime : attente-limite');
    // D : --bootstrap bloqué par un 429 — verrou d'attente sans instance correspondante → signalé quand même.
    fs.unlinkSync(path.join(f.root, 'mission/.holarch/live/concepteur.attente.json'));
    ecrire(f.root, 'mission/.holarch/live/racine-neuve.attente.json', JSON.stringify({ pid: process.pid, jusqua: '2026-09-12T14:30:00Z', motif: '429', tentative: 1 }));
    e = collecte.collecter(f.root, deps(f));
    assert.ok(e.anomalies.some((x) => x.code === 'attente-limite' && x.chemin === 'racine-neuve'), JSON.stringify(e.anomalies));
  } finally { nettoyer(f.root); }
});

test('budget-au-seuil suit seuil_budget_pct (point 10) : 60 % → info à 0,65, rien à 0,55', () => {
  const f = fabriquer();
  try {
    const cfg = fs.readFileSync(path.join(f.root, 'framework/CONFIG.md'), 'utf8');
    ecrire(f.root, 'framework/CONFIG.md', `${cfg}| seuil_budget_pct | 60 |\n`);
    ecrire(f.root, 'mission/.holarch/live/concepteur.json', JSON.stringify({ pid: process.pid, startedAt: '2026-09-12T09:00:00Z', attempt: 1 }));
    ecrire(f.root, 'mission/.holarch/live/concepteur.budget.json', JSON.stringify({ session_id: 's', plafond: 10, depense: 6.5, ratio: 0.65, source: 'cli', ordre_a: null }));
    let e = collecte.collecter(f.root, deps(f));
    assert.ok(e.anomalies.some((x) => x.code === 'budget-au-seuil'), 'ratio 0,65 ≥ seuil 60 %');
    ecrire(f.root, 'mission/.holarch/live/concepteur.budget.json', JSON.stringify({ session_id: 's', plafond: 10, depense: 5.5, ratio: 0.55, source: 'cli', ordre_a: null }));
    e = collecte.collecter(f.root, deps(f));
    assert.ok(!e.anomalies.some((x) => x.code === 'budget-au-seuil'), 'ratio 0,55 < seuil 60 %');
  } finally { nettoyer(f.root); }
});

// -- chantier 16, §18.4-18.6 : jobs, charge machine, lots ------------------------------------------

test('jobs et lots : job-orphelin, job-sans-progres (horloge simulée), lourd-hors-job (jetons exclus), lot-en-cours, coût et budget des services', () => {
  const f = fabriquer();
  try {
    const cfg = fs.readFileSync(path.join(f.root, 'framework/CONFIG.md'), 'utf8');
    ecrire(f.root, 'framework/CONFIG.md', `${cfg}| budget_services_usd | 10 |\n| job_silence_max_min | 10 |\n| motifs_lourds | ffmpeg, blender |\n`);
    const mort = 2 ** 22 - 5;
    const job = (id, etat, pid, extra) => ecrire(f.root, `mission/.holarch/jobs/${id}.json`, JSON.stringify(Object.assign({ id, proprietaire: 'concepteur', etat, pid_superviseur: pid, pgid: 900, debut: '2026-09-11T10:00:00Z' }, extra || {})));
    job('orph-1', 'en-cours', mort);
    job('fini-1', 'fini', mort);
    job('vif-1', 'en-cours', process.pid, { pgid: 901 });
    ecrire(f.root, 'mission/.holarch/jobs/vif-1.log', 'x');
    const logStat = fs.statSync(path.join(f.root, 'mission/.holarch/jobs/vif-1.log'));
    const charge = path.join(f.root, 'charge');
    ecrire(f.root, 'charge/jeton-0', JSON.stringify({ pid: 4242, mission: 'autre' }));
    const procs = [
      { pid: 10, ppid: 1, pgid: 10, commande: 'ffmpeg -i a.mp4 b.mp4' },
      { pid: 11, ppid: 4242, pgid: 11, commande: '/usr/bin/blender -b x' },
      { pid: 12, ppid: 1, pgid: 901, commande: 'ffmpeg -i c.mp4' },
      { pid: 13, ppid: 1, pgid: 13, commande: 'node ffmpeg-notes.js' },
    ];
    ecrire(f.root, 'mission/lots/plans.json', JSON.stringify({ nom: 'plans', elements: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }));
    job('lot-1', 'en-cours', process.pid, { pgid: 902, cwd: f.root, nom: 'plans', commande: ['node', 'holarch-job.js', 'jouer-lot', 'mission/lots/plans.json', '--cle', 'k'] });
    ecrire(f.root, 'mission/.holarch/jobs/lot-1.log', 'x');
    ecrire(f.root, 'mission/.holarch/lots/k.lock', JSON.stringify({ proprietaire: 'concepteur', pid: process.pid, job: 'lot-1', debut: '2026-09-11T10:00:00Z' }));
    ecrire(f.root, 'mission/.holarch/lots/couts.jsonl', `${JSON.stringify({ date: '2026-09-11T10:05:00Z', lot: 'plans', empreinte: 'aaaaaaaaaaaa1', cout_usd: 5, etat: 'fait' })}\n${JSON.stringify({ date: '2026-09-11T10:06:00Z', lot: 'plans', empreinte: 'bbbbbbbbbbbb1', cout_usd: 2, etat: 'fait' })}\n`);
    ecrire(f.root, 'mission/registry/COUTS-SERVICES.md', '| Date | Lot | Élément | Service | Empreinte (12) | Coût | Source | Propriétaire | État |\n|---|---|---|---|---|---|---|---|---|\n| 2026-09-11T10:05:00Z | plans | a | s | aaaaaaaaaaaa | 5 | réel | concepteur | fait |\n| 2026-09-11T09:00:00Z | autre \\| 1/2 | z | s | cccccccccccc | ≈1.5 | estimé | concepteur | fait |\n');
    const now = () => new Date(logStat.mtimeMs + 11 * 60 * 1000);
    const e = collecte.collecter(f.root, deps(f, { now, chargeDir: () => charge, processus: () => procs, pidVivant: (pid) => pid === process.pid || pid === 4242 }));
    const codes = (c) => e.anomalies.filter((a) => a.code === c);
    assert.equal(codes('job-orphelin').length, 1);
    assert.match(codes('job-orphelin')[0].texte, /orph-1/);
    assert.deepEqual(codes('job-sans-progres').map((a) => a.texte.includes('vif-1') || a.texte.includes('lot-1')), [true, true]);
    assert.deepEqual(codes('lourd-hors-job').map((a) => a.texte.match(/pid (\d+)/)[1]), ['10'], JSON.stringify(codes('lourd-hors-job')));
    assert.equal(codes('lot-en-cours').length, 1);
    assert.equal(codes('lot-en-cours')[0].texte, 'lot plans (concepteur) : 2/3 élément(s)');
    assert.equal(e.mission.coutServicesUsd, 8.5, 'revue n° 21 : « \\| » échappé dans le nom du lot ne décale pas le coût');
    assert.equal(codes('budget-services-au-seuil').length, 1);
    assert.match(observe.formater(e), new RegExp(`Coût des services \\(lots, couts\\.jsonl\\) : 8\\.50 USD sur ${e.mission.budgetServicesUsd} \\(`));
    const tot = collecte.collecter(f.root, deps(f, { now: () => new Date(logStat.mtimeMs + 60 * 1000), chargeDir: () => charge, processus: () => procs, pidVivant: (pid) => pid === process.pid || pid === 4242 }));
    assert.equal(tot.anomalies.filter((a) => a.code === 'job-sans-progres').length, 0, 'journal récent : aucun job-sans-progres');
  } finally { nettoyer(f.root); }
});

test('revue n° 30 : --progression relatif lu depuis le cwd du job, pas celui d\'observe (aucune fausse alerte)', () => {
  const f = fabriquer();
  try {
    const cfg = fs.readFileSync(path.join(f.root, 'framework/CONFIG.md'), 'utf8');
    ecrire(f.root, 'framework/CONFIG.md', `${cfg}| job_silence_max_min | 10 |\n`);
    const wt = path.join(f.root, 'wt');
    ecrire(f.root, 'mission/.holarch/jobs/rendu-1.json', JSON.stringify({ id: 'rendu-1', proprietaire: 'concepteur', etat: 'en-cours', pid_superviseur: process.pid, pgid: 903, debut: '2026-09-11T10:00:00Z', cwd: wt, progression: 'out/prog.txt' }));
    ecrire(f.root, 'mission/.holarch/jobs/rendu-1.log', 'x');
    ecrire(f.root, 'wt/out/prog.txt', '42 %');
    const vieux = new Date(Date.now() - 30 * 60 * 1000);
    fs.utimesSync(path.join(f.root, 'mission/.holarch/jobs/rendu-1.log'), vieux, vieux);
    const e = collecte.collecter(f.root, deps(f, { now: () => new Date(), pidVivant: (pid) => pid === process.pid }));
    assert.deepEqual(e.anomalies.filter((a) => a.code === 'job-sans-progres').map((a) => a.texte), []);
  } finally { nettoyer(f.root); }
});

test('revue n° 36 : budget-au-seuil lit ratio_total et la réserve franchie par un sous-agent', () => {
  const f = fabriquer();
  try {
    ecrire(f.root, 'mission/.holarch/live/concepteur.json', JSON.stringify({ pid: process.pid, startedAt: '2026-09-12T09:00:00Z', attempt: 1 }));
    ecrire(f.root, 'mission/.holarch/live/concepteur.budget.json', JSON.stringify({ session_id: 's', plafond: 15, depense: 10.5, ratio: 0.7, source: 'cli', ordre_a: null, ratio_total: 13 / 15, depense_totale: 13 }));
    let e = collecte.collecter(f.root, deps(f));
    const a = e.anomalies.find((x) => x.code === 'budget-au-seuil');
    assert.ok(a, 'ratio_total 0,87 ≥ 80 %');
    assert.match(a.message || a.texte || JSON.stringify(a), /87%.*13 dont sous-agents\/15/);
    ecrire(f.root, 'mission/.holarch/live/concepteur.budget.json', JSON.stringify({ session_id: 's', plafond: 15, depense: 10.5, ratio: 0.7, source: 'cli', ordre_a: null, ratio_total: 0.75, consigne_sous_agents: ['/t/sa/subagents/a.jsonl'] }));
    e = collecte.collecter(f.root, deps(f));
    assert.ok(e.anomalies.some((x) => x.code === 'budget-au-seuil'), 'consigne donnée à un sous-agent = réserve franchie');
  } finally { nettoyer(f.root); }
});

test('seconde revue n° 55 : job en file au-delà de 3 × job_silence_max_min → anomalie job-en-file-long', () => {
  const f = fabriquer();
  try {
    const cfg = fs.readFileSync(path.join(f.root, 'framework/CONFIG.md'), 'utf8');
    ecrire(f.root, 'framework/CONFIG.md', `${cfg}| job_silence_max_min | 10 |\n`);
    ecrire(f.root, 'mission/.holarch/jobs/file-1.json', JSON.stringify({ id: 'file-1', proprietaire: 'concepteur', etat: 'en-file', pid_superviseur: process.pid, debut: null }));
    const st = fs.statSync(path.join(f.root, 'mission/.holarch/jobs/file-1.json'));
    const voir = (min) => collecte.collecter(f.root, deps(f, { now: () => new Date(st.mtimeMs + min * 60 * 1000), pidVivant: (pid) => pid === process.pid }))
      .anomalies.filter((a) => a.code === 'job-en-file-long');
    assert.equal(voir(25).length, 0, '25 min < 30 : file normale');
    assert.equal(voir(31).length, 1);
    assert.match(voir(31)[0].texte, /file-1 en file depuis 31 min/);
  } finally { nettoyer(f.root); }
});

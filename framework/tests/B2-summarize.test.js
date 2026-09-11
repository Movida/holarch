'use strict';
/**
 * B2 — `summarize()`, codes de sortie 0/2/3 et boucle de ré-incarnation.
 *
 * Fichier autonome, aucune dépendance, aucun appel réseau, aucun `claude` lancé.
 *
 * Lacune couverte (constat B2 de l'audit indépendant du 2026-09-03) : `summarize()` et les codes de
 * sortie 0/2/3 portent TOUTE la boucle de supervision parent→enfant décrite par `direct-spawn`
 * (ON_SUPERVISE, points 3 et 4 : « lis uniquement la ligne de synthèse », « si le lanceur signale que
 * STATUS est resté à WORKING (code 2)… un deuxième échec fait passer l'enfant à FAILED »). Avant ce
 * fichier, aucun test ne les touchait : un parent pouvait donc être orienté vers un recadrage — ou
 * dispensé d'en faire un — par du code jamais vérifié.
 *
 * Convention : chaque test nomme le comportement contractuel qu'il verrouille, pas la fonction testée.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Racine du dépôt : remonte jusqu'au répertoire portant framework/KERNEL.md (marche depuis
 *  framework/tests/ comme depuis mission/shared/... — le fichier est déplaçable sans retouche). */
function repoRoot(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'framework', 'KERNEL.md'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error('racine HOLARCH introuvable depuis ' + start);
}
const ROOT = repoRoot(__dirname);
const launcher = require(path.join(ROOT, 'framework', 'bin', 'holarch-spawn.js'));

// ---------------------------------------------------------------------------
// Doublures : une « session » telle que la fabrique `launchWithRelaunches`.
// ---------------------------------------------------------------------------
const LAUNCH = { chemin: 'concepteur/enfant', meta: { modele: 'sonnet', effort: 'medium' } };

function res(over = {}) {
  return Object.assign({
    type: 'result', subtype: 'success', session_id: 'abcdefgh-1111-2222-3333-444444444444',
    total_cost_usd: 0.5, num_turns: 7, usage: {}, permission_denials: [], is_error: false,
  }, over);
}
function session(over = {}) {
  return Object.assign({
    res: res(), elapsedMs: 65000, exitCode: 0, signal: null,
    logBase: '/tmp/holarch-log', status: { etat: 'DELIVERED', note: '' },
  }, over);
}
const sum = (sessions) => launcher.summarize(LAUNCH, sessions);

// ---------------------------------------------------------------------------
// 1. Le cas nominal : code 0, et une ligne de synthèse que le parent peut lire seule.
// ---------------------------------------------------------------------------
test('summarize : état terminal → code 0 et ligne de synthèse complète', () => {
  const { text, code } = sum([session()]);
  assert.equal(code, 0);
  const first = text.split('\n')[0];
  // Format contractuel lu par le parent (direct-spawn, ON_SUPERVISE point 3).
  assert.match(first, /^HOLARCH ▸ concepteur\/enfant ▸ STATUS=DELIVERED · 1 session\(s\) · 7 tours · 0\.50 USD · 1m05s · sonnet\/medium · sessions abcdefgh$/);
  // Rien d'alarmant ne doit être ajouté sur un cas nominal, hormis le pointeur vers le journal.
  assert.doesNotMatch(text, /⚠/);
  assert.match(text, /journal des sessions : mission\/registry\/SESSIONS\.md/);
});

test('summarize : les états terminaux non-DELIVERED restent en code 0 (le parent arbitre, pas le lanceur)', () => {
  for (const etat of ['BLOCKED', 'FAILED', 'WAITING_CHILDREN', 'ARCHIVED', 'READY']) {
    const { text, code } = sum([session({ status: { etat, note: '' } })]);
    assert.equal(code, 0, `état ${etat}`);
    assert.match(text, new RegExp(`STATUS=${etat}`));
    assert.doesNotMatch(text, /⚠/, `état ${etat} : aucun avertissement attendu`);
  }
});

// ---------------------------------------------------------------------------
// 2. Les trois façons de sortir en code 2 — celles qui déclenchent le recadrage côté parent.
// ---------------------------------------------------------------------------
test('summarize : STATUS resté à WORKING sans note d\'hibernation → code 2 et consigne de relance', () => {
  const { text, code } = sum([session({ status: { etat: 'WORKING', note: '' } })]);
  assert.equal(code, 2);
  assert.match(text, /STATUS\.md est resté à WORKING/);
  assert.match(text, /relancer une fois, puis FAILED \+ recadrage/); // la consigne exacte de direct-spawn
});

test('summarize : une note d\'hibernation sur un STATUS non-WORKING ne masque pas l\'anomalie', () => {
  // Garde-fou anti-contournement : écrire « hibernation volontaire » dans la Note d'un STATUS DELIVERED
  // ne doit pas transformer le verdict ; et la même note sur un WORKING ne doit pas donner un code 2.
  assert.equal(sum([session({ status: { etat: 'DELIVERED', note: 'hibernation volontaire (contexte)' } })]).code, 0);
  assert.equal(sum([session({ status: { etat: 'WORKING', note: 'Hibernation Volontaire (contexte)' } })]).code, 3);
});

test('summarize : aucun résultat JSON du CLI → code 2, avec le code de sortie et le journal brut', () => {
  const { text, code } = sum([session({ res: null, exitCode: 137, signal: 'SIGKILL', status: { etat: 'DELIVERED', note: '' } })]);
  assert.equal(code, 2);
  assert.match(text, /aucun résultat JSON du CLI \(code 137, signal SIGKILL\)/);
  assert.match(text, /\/tmp\/holarch-log\.stderr\.log/); // le parent doit pouvoir aller voir
  // Sans résultat JSON, coût et tours valent 0 plutôt que « ? » : la ligne reste lisible.
  assert.match(text, /· 0 tours · 0\.00 USD ·/);
});

test('summarize : résultat JSON en erreur → code 2 et pointeur vers le résultat brut', () => {
  const { text, code } = sum([session({ res: res({ is_error: true, subtype: 'error_max_turns' }) })]);
  assert.equal(code, 2);
  assert.match(text, /fin anormale : error_max_turns/);
  assert.match(text, /\/tmp\/holarch-log\.result\.json/);
});

// ---------------------------------------------------------------------------
// 3. Le code 3 — hibernation volontaire épuisée : ce n'est PAS un échec (direct-spawn, point 4).
// ---------------------------------------------------------------------------
test('summarize : hibernations volontaires épuisées → code 3, distinct du plantage', () => {
  const sessions = [
    session({ status: { etat: 'WORKING', note: 'hibernation volontaire (contexte)' } }),
    session({ status: { etat: 'WORKING', note: 'hibernation volontaire (contexte)' } }),
  ];
  const { text, code } = sum(sessions);
  assert.equal(code, 3);
  assert.match(text, /2 session\(s\) en hibernation volontaire sans progrès/);
  // Ne doit surtout pas être présenté comme une session plantée : le parent relance sans recadrer.
  assert.doesNotMatch(text, /session plantée/);
  assert.doesNotMatch(text, /FAILED \+ recadrage/);
});

test('summarize : un plantage pendant une hibernation volontaire reste signalé, code 3 (relance, pas recadrage)', () => {
  // Cas mixte : le CLI n'a rien rendu, mais la session avait posé sa note d'hibernation. La consigne
  // utile au parent est de relancer ; l'anomalie du CLI doit néanmoins rester visible dans le texte.
  const { text, code } = sum([session({ res: null, exitCode: 1, status: { etat: 'WORKING', note: 'hibernation volontaire (contexte)' } })]);
  assert.equal(code, 3);
  assert.match(text, /aucun résultat JSON du CLI/);
  assert.match(text, /hibernation volontaire sans progrès/);
});

// ---------------------------------------------------------------------------
// 4. Agrégation multi-sessions, refus d'outil, note de STATUS.
// ---------------------------------------------------------------------------
test('summarize : agrège coût, tours et durée sur toutes les tentatives, et liste les sessions', () => {
  const sessions = [
    session({ res: res({ session_id: '11111111-a', total_cost_usd: 1.25, num_turns: 30 }), elapsedMs: 60000, status: { etat: 'WORKING', note: 'hibernation volontaire (contexte)' } }),
    session({ res: res({ session_id: '22222222-b', total_cost_usd: 2.5, num_turns: 12 }), elapsedMs: 5000 }),
  ];
  const { text, code } = sum(sessions);
  assert.equal(code, 0); // le dernier STATUS est terminal : l'hibernation intermédiaire n'est pas une anomalie
  assert.match(text, /STATUS=DELIVERED · 2 session\(s\) · 42 tours · 3\.75 USD · 1m05s/);
  assert.match(text, /sessions 11111111, 22222222/);
});

test('summarize : une tentative sans résultat JSON n\'empêche pas d\'agréger les autres', () => {
  const sessions = [
    session({ res: null, status: { etat: 'WORKING', note: 'hibernation volontaire (contexte)' } }),
    session({ res: res({ total_cost_usd: 2, num_turns: 9 }) }),
  ];
  const { text } = sum(sessions);
  assert.match(text, /2 session\(s\) · 9 tours · 2\.00 USD/);
  assert.match(text, /sessions —, abcdefgh/);
});

test('summarize : compte les refus d\'outil de toutes les tentatives et reprend la note de STATUS', () => {
  const sessions = [
    session({ res: res({ permission_denials: [{ tool_name: 'Edit' }, { tool_name: 'Bash' }] }), status: { etat: 'WORKING', note: 'hibernation volontaire (contexte)' } }),
    session({ res: res({ permission_denials: [{ tool_name: 'Write' }] }), status: { etat: 'BLOCKED', note: 'Manque la spécification du format de sortie.' } }),
  ];
  const { text } = sum(sessions);
  assert.match(text, /ℹ 3 appel\(s\) d'outil refusé\(s\)/);
  assert.match(text, /ℹ note STATUS : Manque la spécification du format de sortie\./);
});

test('summarize : aucune ligne de refus quand il n\'y en a pas, et note tronquée à 300 caractères', () => {
  assert.doesNotMatch(sum([session()]).text, /appel\(s\) d'outil refusé/);
  const longue = 'x'.repeat(500);
  const { text } = sum([session({ status: { etat: 'BLOCKED', note: longue } })]);
  const ligne = text.split('\n').find((l) => l.startsWith('ℹ note STATUS'));
  assert.equal(ligne.length, 'ℹ note STATUS : '.length + 300);
});

// ---------------------------------------------------------------------------
// 5. La boucle de ré-incarnation, bout en bout avec un runner injecté (aucun `claude` lancé).
// ---------------------------------------------------------------------------
function status(etat, note = '') {
  return `# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | ${etat} |\n| Depuis | 2026-09-03T00:00:00Z |\n| Posé par | soi |\n| Note | ${note} |\n`;
}
function fiche(chemin) {
  return `# ${chemin}\n| Champ | Valeur |\n|---|---|\n| Statut | READY |\n| Budget alloué / consommé | 2 / 0 |\n| Profil | execution |\n`;
}
/** Racine de mission jetable, minimale mais suffisante pour prepareLaunch. */
function makeRoot(relances) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-b2-'));
  const w = (rel, c) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
  w('framework/KERNEL.md', '# KERNEL de test\n');
  w('framework/CONFIG.md', `# Configuration — mission : test-b2\n\n## Modules actifs\n| # | Catégorie | Module |\n|---|---|---|\n| 1 | orchestration | direct-spawn |\n\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n| relances_max | ${relances} |\n`);
  w('framework/modules/orchestration/direct-spawn.md', '# Module : direct-spawn\n');
  w('framework/claude/instance-settings.json', '{}');
  w('mission/concepteur/enfant/ROLE.md', '# Rôle : enfant\n');
  w('mission/concepteur/enfant/MEMORY.md', '# Mémoire\n');
  w('mission/concepteur/enfant/INBOX.md', '# Boîte\n');
  w('mission/concepteur/enfant/STATUS.md', status('READY'));
  w('mission/registry/instances/concepteur-enfant.md', fiche('concepteur/enfant'));
  w('mission/registry/PROGRESS.md', '# Avancement\n');
  return root;
}
const setStatus = (root, etat, note) => fs.writeFileSync(path.join(root, 'mission/concepteur/enfant/STATUS.md'), status(etat, note));
const sessionsLines = (root) => fs.readFileSync(path.join(root, 'mission/registry/SESSIONS.md'), 'utf8').split('\n').filter((l) => l.includes('| concepteur/enfant |'));

test('launchWithRelaunches : ré-incarne tant que l\'hibernation est volontaire, puis s\'arrête à relances_max', () => {
  const root = makeRoot(2);
  let n = 0;
  const runner = () => { n += 1; setStatus(root, 'WORKING', 'hibernation volontaire (contexte)'); return { res: res(), elapsedMs: 10 }; };
  const sessions = launcher.launchWithRelaunches(root, 'concepteur/enfant', {}, runner);
  // relances_max = 2 → 1 lancement + 2 ré-incarnations = 3 sessions, puis abandon.
  assert.equal(n, 3);
  assert.equal(sessions.length, 3);
  assert.equal(sessionsLines(root).length, 3); // une ligne SESSIONS.md par tentative, append-only
  assert.equal(launcher.summarize(sessions[2].launch, sessions).code, 3);
});

test('launchWithRelaunches : relances_max = 0 → aucune ré-incarnation', () => {
  const root = makeRoot(0);
  let n = 0;
  const runner = () => { n += 1; setStatus(root, 'WORKING', 'hibernation volontaire (contexte)'); return { res: res(), elapsedMs: 10 }; };
  const sessions = launcher.launchWithRelaunches(root, 'concepteur/enfant', {}, runner);
  assert.equal(n, 1);
  assert.equal(sessions.length, 1);
  assert.equal(launcher.summarize(sessions[0].launch, sessions).code, 3);
});

test('launchWithRelaunches : un WORKING NON volontaire n\'est jamais relancé par le lanceur (c\'est au parent)', () => {
  // Distinction structurante de direct-spawn : le lanceur relance l'hibernation volontaire (code 3),
  // il ne relance jamais une session plantée (code 2) — cette décision appartient au parent, qui
  // recadre au deuxième échec consécutif. Confondre les deux ferait boucler un enfant en échec.
  const root = makeRoot(2);
  let n = 0;
  const runner = () => { n += 1; setStatus(root, 'WORKING', ''); return { res: res(), elapsedMs: 10 }; };
  const sessions = launcher.launchWithRelaunches(root, 'concepteur/enfant', {}, runner);
  assert.equal(n, 1);
  assert.equal(launcher.summarize(sessions[0].launch, sessions).code, 2);
});

test('launchWithRelaunches : journalise le STATUS réel de chaque tentative dans SESSIONS.md', () => {
  const root = makeRoot(2);
  const runner = (launch, attempt) => {
    if (attempt === 1) setStatus(root, 'WORKING', 'hibernation volontaire (contexte)');
    else setStatus(root, 'DELIVERED');
    return { res: res({ num_turns: attempt * 10, total_cost_usd: 1 }), elapsedMs: 1000 };
  };
  const sessions = launcher.launchWithRelaunches(root, 'concepteur/enfant', {}, runner);
  assert.equal(sessions.length, 2);
  const lignes = sessionsLines(root);
  assert.match(lignes[0], /\| WORKING \| \d+ \/ \d+ \| — \/ — \|$/);
  assert.match(lignes[1], /\| DELIVERED \| \d+ \/ \d+ \| — \/ — \|$/);
  assert.equal(launcher.summarize(sessions[1].launch, sessions).code, 0);
});

test('launchWithRelaunches : STATUS.md illisible → « (absent) » journalisé, sans exception', () => {
  const root = makeRoot(0);
  const runner = () => { fs.rmSync(path.join(root, 'mission/concepteur/enfant/STATUS.md')); return { res: res(), elapsedMs: 10 }; };
  const sessions = launcher.launchWithRelaunches(root, 'concepteur/enfant', {}, runner);
  assert.match(sessionsLines(root)[0], /\| \(absent\) \| \d+ \/ \d+ \| — \/ — \|$/);
  assert.match(launcher.summarize(sessions[0].launch, sessions).text, /STATUS=\(absent\)/);
});

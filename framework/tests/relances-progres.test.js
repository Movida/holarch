'use strict';
// Boucle de ré-incarnation gouvernée par le progrès (framework 1.5.0, holarch.md §15 décision 23) :
// relances_max borne les sessions consécutives SANS progrès (fiche d'unité ou commit [<chemin>]),
// sessions_max_par_instance borne le total ; épuisé ⇒ ALERT du lanceur dans l'INBOX du parent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const launcher = require('../bin/holarch-spawn.js');

function status(etat, note = '') {
  return `# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | ${etat} |\n| Depuis | 2026-09-10T00:00:00Z |\n| Posé par | soi |\n| Note | ${note} |\n`;
}
function res(i) { return { type: 'result', subtype: 'success', session_id: `s${i}`, total_cost_usd: 0.01, num_turns: 1, usage: {}, is_error: false }; }

/** Racine jetable : parent `concepteur` (INBOX présente) et enfant `concepteur/enfant`, sans dépôt Git (progrès par fiches). */
function makeRoot({ relances = 1, plafond = 0 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-progres-'));
  const w = (rel, c) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
  w('framework/KERNEL.md', '# KERNEL de test\n');
  w('framework/CONFIG.md', `# Configuration — mission : test-progres\n\n## Modules actifs\n| # | Catégorie | Module |\n|---|---|---|\n| 1 | orchestration | direct-spawn |\n\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n| relances_max | ${relances} |\n| sessions_max_par_instance | ${plafond} |\n`);
  w('framework/modules/orchestration/direct-spawn.md', '# Module : direct-spawn\n');
  w('framework/claude/instance-settings.json', '{}');
  w('mission/concepteur/ROLE.md', '# Rôle : concepteur\n');
  w('mission/concepteur/MEMORY.md', '# Mémoire\n');
  w('mission/concepteur/STATUS.md', status('WAITING_CHILDREN'));
  w('mission/concepteur/INBOX.md', '# INBOX — concepteur\n');
  w('mission/concepteur/enfant/ROLE.md', '# Rôle : enfant\n');
  w('mission/concepteur/enfant/MEMORY.md', '# Mémoire\n');
  w('mission/concepteur/enfant/INBOX.md', '# Boîte\n');
  w('mission/concepteur/enfant/STATUS.md', status('READY'));
  w('mission/registry/instances/concepteur.md', '# concepteur\n| Champ | Valeur |\n|---|---|\n| Statut | WORKING |\n| Budget alloué / consommé | 3 / 1 |\n| Profil | conception |\n');
  w('mission/registry/instances/concepteur-enfant.md', '# concepteur/enfant\n| Champ | Valeur |\n|---|---|\n| Statut | READY |\n| Budget alloué / consommé | 1 / 0 |\n| Profil | execution |\n');
  w('mission/registry/PROGRESS.md', '# Avancement\n');
  return root;
}
const ENFANT = 'concepteur/enfant';
const hiberne = (root) => fs.writeFileSync(path.join(root, 'mission', ENFANT, 'STATUS.md'), status('WORKING', 'hibernation volontaire (contexte) — U en cours'));
const fiche = (root, n) => { const p = path.join(root, 'mission', ENFANT, 'memoire', `U${n}-etape.md`); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, `---\nid: U${n}\n---\n`); };
const inboxParent = (root) => fs.readFileSync(path.join(root, 'mission/concepteur/INBOX.md'), 'utf8');

test('progrès à chaque session (fiche d\'unité) : la ré-incarnation continue au-delà de relances_max, jusqu\'au plafond, puis ALERT au parent', () => {
  const root = makeRoot({ relances: 1, plafond: 4 });
  let n = 0;
  const runner = () => { n += 1; fiche(root, n); hiberne(root); return { res: res(n), elapsedMs: 10 }; };
  const sessions = launcher.launchWithRelaunches(root, ENFANT, {}, runner);
  assert.equal(n, 4, 'quatre sessions : le progrès remet relances à zéro, seul le plafond arrête');
  assert.equal(sessions[3].arret.motif, 'plafond');
  const { text, code } = launcher.summarize(sessions[3].launch, sessions);
  assert.equal(code, 3);
  assert.match(text, /plafond sessions_max_par_instance \(4\)/);
  assert.match(text, /ALERT MSG-harnais-concepteur-enfant-\d+ déposé dans l'INBOX du parent/);
  const inbox = inboxParent(root);
  assert.match(inbox, /^type: ALERT$/m);
  assert.match(inbox, /^from: harnais$/m);
  assert.match(inbox, /^to: concepteur$/m);
  assert.match(inbox, /plafond `sessions_max_par_instance` \(4\)/);
  assert.match(inbox, /holarch-spawn\.js concepteur\/enfant --detach/);
});

test('aucun progrès : arrêt après relances_max sessions consécutives sans trace, ALERT « sans progrès »', () => {
  const root = makeRoot({ relances: 1 });
  let n = 0;
  const runner = () => { n += 1; hiberne(root); return { res: res(n), elapsedMs: 10 }; };
  const sessions = launcher.launchWithRelaunches(root, ENFANT, {}, runner);
  assert.equal(n, 2, '1 lancement + relances_max = 1 ré-incarnation, puis arrêt');
  assert.equal(sessions[1].arret.motif, 'sans-progres');
  assert.match(inboxParent(root), /2 session\(s\) consécutive\(s\) en hibernation volontaire sans progrès/);
  assert.match(launcher.summarize(sessions[1].launch, sessions).text, /2 session\(s\) en hibernation volontaire sans progrès/);
});

test('le progrès remet le compte à zéro : progrès, puis deux sessions vides → arrêt à la troisième', () => {
  const root = makeRoot({ relances: 1 });
  let n = 0;
  const runner = () => { n += 1; if (n === 1) fiche(root, 1); hiberne(root); return { res: res(n), elapsedMs: 10 }; };
  const sessions = launcher.launchWithRelaunches(root, ENFANT, {}, runner);
  assert.equal(n, 3);
  assert.equal(sessions[2].arret.sansProgres, 2);
});

test('sessions_max_par_instance compte toutes les invocations : les lignes déjà présentes dans SESSIONS.md', () => {
  const root = makeRoot({ relances: 1, plafond: 4 });
  const p = path.join(root, 'mission/registry/SESSIONS.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const ligne = (i) => `| 2026-09-10T0${i}:00:00Z | ${ENFANT} | s-ancienne-${i} | sonnet/medium | 1 | 0 / 0 / 0 / 0 | 0.0000 | 1s | success | WORKING | 1 / 1 |\n`;
  fs.writeFileSync(p, `# Sessions — mission test\n\n| Date (UTC) | Instance | Session | Modèle / effort | Tours | Tokens | Coût USD | Durée | Fin | STATUS | Réveil |\n|---|---|---|---|---|---|---|---|---|---|---|\n${ligne(1)}${ligne(2)}${ligne(3)}`);
  assert.equal(launcher.countSessions(root, ENFANT), 3);
  let n = 0;
  const runner = () => { n += 1; fiche(root, n); hiberne(root); return { res: res(n), elapsedMs: 10 }; };
  const sessions = launcher.launchWithRelaunches(root, ENFANT, {}, runner);
  assert.equal(n, 1, 'la quatrième session atteint le plafond malgré le progrès');
  assert.equal(sessions[0].arret.motif, 'plafond');
  assert.equal(sessions[0].arret.total, 4);
});

test('racine sans parent : pas d\'ALERT, la synthèse renvoie à une relance manuelle', () => {
  const root = makeRoot({ relances: 0 });
  fs.writeFileSync(path.join(root, 'mission/concepteur/MEMORY.md'), '# Mémoire\n');
  const runner = () => { fs.writeFileSync(path.join(root, 'mission/concepteur/STATUS.md'), status('WORKING', 'hibernation volontaire (contexte)')); return { res: res(1), elapsedMs: 10 }; };
  const sessions = launcher.launchWithRelaunches(root, 'concepteur', {}, runner);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].arret.alerte, null);
  assert.match(launcher.summarize(sessions[0].launch, sessions).text, /relancer manuellement \(racine sans parent\)/);
  assert.equal(launcher.appendAlertToParent(root, 'concepteur', 'x'), null);
});

// --- 1.7.0 : une ré-incarnation après --bootstrap repart comme instance racine ordinaire ---------------------
// Dogfooding du chantier 3 (2026-09-10) : la racine a hiberné volontairement dès sa première session, et le
// lanceur l'a ré-incarnée trois fois EN MODE BOOTSTRAP — chaque session refusant « mission déjà en cours »
// sans rien faire, jusqu'à l'arrêt « sans progrès ».
test('--bootstrap : la première session reçoit BOOTSTRAP.md, les ré-incarnations suivantes repartent comme instance racine ordinaire', () => {
  const root = makeRoot({ relances: 2, plafond: 6 });
  fs.writeFileSync(path.join(root, 'framework/BOOTSTRAP.md'), '# BOOTSTRAP de test\nÉtape 1 : refuser si mission déjà en cours.\n');
  const RACINE = 'concepteur';
  const statusRacine = (etat, note) => fs.writeFileSync(path.join(root, 'mission', RACINE, 'STATUS.md'), status(etat, note));
  let n = 0;
  const runner = (launch) => {
    n += 1;
    if (n === 1) statusRacine('WORKING', 'hibernation volontaire (budget) — enfants spawnés mais non lancés');
    else if (n === 2) statusRacine('WORKING', 'hibernation volontaire (contexte) — U2 en cours');
    else statusRacine('WAITING_CHILDREN', '');
    return { res: res(n), elapsedMs: 10 };
  };
  const sessions = launcher.launchWithRelaunches(root, RACINE, { bootstrap: true }, runner);
  assert.equal(n, 3);
  assert.match(sessions[0].launch.prompt, /Tu es la première session de cette mission/);
  assert.match(sessions[0].launch.systemPrompt, /BOOTSTRAP de test/);
  for (const s of sessions.slice(1)) {
    assert.doesNotMatch(s.launch.prompt, /première session de cette mission/, 'une ré-incarnation ne rejoue pas BOOTSTRAP');
    assert.doesNotMatch(s.launch.systemPrompt, /BOOTSTRAP de test/);
    assert.match(s.launch.prompt, /ON_WAKE/);
  }
});

// --- 1.7.2 : une limite de sessions de l'API (429) n'est pas une session « sans progrès » --------------------------
// Mission holarch-provenance (2026-09-10) : trois 429 d'affilée (23 s, 1 s, 1 s, « session limit · resets 7:50pm (UTC) »)
// comptés comme trois sessions sans progrès → enfant arrêté, ALERT trompeur au parent.
test('429 : le lanceur attend la remise à zéro et retente sans décompter de relance ; sans heure lisible, arrêt avec le motif limite-api', () => {
  const res429 = (i, texte) => ({ type: 'result', subtype: 'success', is_error: true, api_error_status: 429, result: texte, session_id: `e${i}`, total_cost_usd: 0, num_turns: 1, usage: {} });
  // (a) heure lisible : attente (forcée à 0 ms par l'env) puis reprise, la session suivante progresse normalement.
  process.env.HOLARCH_ATTENTE_429_MS = '0';
  try {
    const root = makeRoot({ relances: 1, plafond: 0 });
    let n = 0;
    const runner = () => { n += 1; if (n <= 2) return { res: res429(n, "You've hit your session limit · resets 7:50pm (UTC)"), elapsedMs: 5 }; fiche(root, n); fs.writeFileSync(path.join(root, 'mission', ENFANT, 'STATUS.md'), status('DELIVERED')); return { res: res(n), elapsedMs: 10 }; };
    const sessions = launcher.launchWithRelaunches(root, ENFANT, {}, runner);
    // deux 429 (attente forcée à 0 ms, reprise), puis une vraie session qui livre : trois appels, aucun arrêt.
    assert.equal(n, 3, `deux 429 puis une session réelle, obtenu ${n}`);
    assert.equal(sessions.length, 3);
    assert.equal(sessions.filter((s) => s.arret && s.arret.motif === 'limite-api').length, 0, 'aucun arrêt limite-api quand la reprise a réussi');
    assert.doesNotMatch(inboxParent(root), /session\(s\) consécutive\(s\) en hibernation volontaire sans progrès/, 'les 429 ne sont pas comptés comme « sans progrès »');
    const l = launcher.limiteApi(res429(1, "You've hit your session limit · resets 7:50pm (UTC)"));
    assert.equal(l.attenteMs, 0); assert.match(l.texte, /resets 7:50pm/);
  } finally { delete process.env.HOLARCH_ATTENTE_429_MS; }
  // (b) heure illisible : arrêt immédiat avec le vrai motif, ALERT explicite, aucune session « sans progrès », code 3.
  {
    const root = makeRoot({ relances: 1, plafond: 0 });
    let n = 0;
    const runner = () => { n += 1; return { res: res429(n, 'Rate limited, try again later'), elapsedMs: 5 }; };
    const sessions = launcher.launchWithRelaunches(root, ENFANT, {}, runner);
    assert.equal(n, 1, 'pas de nouvelle tentative sans heure de reprise');
    assert.equal(sessions[0].arret.motif, 'limite-api');
    assert.match(inboxParent(root), /limite de sessions de l'API \(429/);
    assert.doesNotMatch(inboxParent(root), /sans progrès/);
    const { text, code } = launcher.summarize(sessions[0].launch, sessions);
    assert.equal(code, 3);
    assert.match(text, /limite de sessions de l'API \(429 : Rate limited/);
    assert.doesNotMatch(text, /fin anormale/);
  }
  // (c) une heure de reprise à plus de 6 h n'est pas attendue.
  const loin = launcher.limiteApi(res429(1, `resets ${new Date(Date.now() + 8 * 3600 * 1000).getUTCHours()}:00 (UTC)`));
  assert.ok(loin.attenteMs === null || loin.attenteMs <= 6 * 3600 * 1000);
});

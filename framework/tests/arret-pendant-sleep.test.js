'use strict';
// 1.13.2 : une demande d'arrêt (--arret) arrivée pendant que la session finissait déjà (ON_SLEEP sur budget ou
// contexte, note sans « arrêt demandé ») ne doit pas être perdue : la boucle de ré-incarnation lit le fichier stop
// avant de relancer, et seul un lancement neuf l'efface. Trois arrêts perdus de suite le 2026-09-11 (mission
// holarch-fournisseurs) : chaque prepareLaunch effaçait le fichier, la session suivante repartait.
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
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-arret-sleep-'));
  const w = (rel, c) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
  w('framework/KERNEL.md', '# KERNEL de test\n');
  w('framework/CONFIG.md', '# Configuration — mission : test-arret\n\n## Modules actifs\n| # | Catégorie | Module |\n|---|---|---|\n| 1 | orchestration | direct-spawn |\n\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n| relances_max | 3 |\n| budget_usd_par_session | 1 |\n');
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
const stopFile = (root) => path.join(root, 'mission', '.holarch', 'stop', 'concepteur-enfant');
const hiberne = (root, note) => fs.writeFileSync(path.join(root, 'mission', ENFANT, 'STATUS.md'), status('WORKING', note));
const fiche = (root, n) => { const p = path.join(root, 'mission', ENFANT, 'memoire', `U${n}-etape.md`); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, `---\nid: U${n}\n---\n`); };

test('--arret posé pendant l\'ON_SLEEP (note « (budget) ») : pas de ré-incarnation, fichier stop consommé, résumé « arrêt propre »', () => {
  const root = makeRoot();
  let n = 0;
  const runner = () => {
    n += 1; fiche(root, n);
    hiberne(root, 'hibernation volontaire (budget) — 1,2 USD restants');
    // l'arrêt arrive alors que la session écrit déjà sa fin : la note ne le mentionne pas
    fs.mkdirSync(path.dirname(stopFile(root)), { recursive: true }); fs.writeFileSync(stopFile(root), '2026-09-11T20:13:05Z\n');
    return { res: res(n), elapsedMs: 10 };
  };
  const sessions = launcher.launchWithRelaunches(root, ENFANT, {}, runner);
  assert.equal(n, 1, 'une seule session : le progrès aurait ré-incarné sans la demande d\'arrêt');
  assert.equal(sessions[0].arretDemande, true);
  assert.equal(fs.existsSync(stopFile(root)), false, 'fichier stop consommé par la boucle');
  const { text, code } = launcher.summarize(sessions[0].launch, sessions);
  assert.equal(code, 0);
  assert.match(text, /arrêt propre demandé \(--arret\)/);
});

test('sans demande d\'arrêt, une hibernation avec progrès est ré-incarnée (comportement inchangé)', () => {
  const root = makeRoot();
  let n = 0;
  const runner = () => { n += 1; fiche(root, n); hiberne(root, n < 2 ? 'hibernation volontaire (budget)' : 'hibernation volontaire (arrêt demandé)'); return { res: res(n), elapsedMs: 10 }; };
  const sessions = launcher.launchWithRelaunches(root, ENFANT, {}, runner);
  assert.equal(n, 2);
  assert.equal(sessions[0].arretDemande, undefined);
});

test('un lancement neuf efface un fichier stop périmé ; une ré-incarnation (opts.relance) le laisse', () => {
  const root = makeRoot();
  fs.mkdirSync(path.dirname(stopFile(root)), { recursive: true }); fs.writeFileSync(stopFile(root), 'périmé\n');
  launcher.prepareLaunch(root, ENFANT, { relance: true });
  assert.equal(fs.existsSync(stopFile(root)), true, 'ré-incarnation : fichier stop intact');
  launcher.prepareLaunch(root, ENFANT, { dryRun: true });
  assert.equal(fs.existsSync(stopFile(root)), true, 'dry-run : fichier stop intact');
  launcher.prepareLaunch(root, ENFANT, {});
  assert.equal(fs.existsSync(stopFile(root)), false, 'lancement neuf : fichier stop périmé effacé');
});

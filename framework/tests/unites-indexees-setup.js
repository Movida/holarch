'use strict';
// Racine jetable commune aux tests du chantier 1 (mémoire adressée) — modèle : makeRoot() de
// framework/tests/holarch.test.js (lignes 55-85), adapté pour activer `unites-indexees`.
const fs = require('fs');
const os = require('os');
const path = require('path');

const CIBLE = path.resolve(__dirname, '..');
const LANCEUR = require(path.join(CIBLE, 'bin', 'holarch-spawn.js'));
const HOOKS = path.join(CIBLE, 'hooks', 'holarch-hooks.js');

const CONFIG_UNITES = `# Configuration — mission : test-unites-indexees
> Preset de base : solo-light · Framework : v1.1

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
| 2 | synchronisation | fork-join |
| 3 | memoire | unites-indexees |
| 4 | recursion | max-depth |
| 5 | registre | sharded-files |

## Paramètres
| Paramètre | Valeur |
|---|---|
| budget_instances_total | 3 |
| profondeur_max | 2 |
| permission_mode | acceptEdits |
| format_rapport_final | simple |
| max_tours_par_session | 42 |
| budget_usd_par_session | 5 |
| seuil_contexte_tokens | 120000 |
| changements_regime_max | 1 |

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| conception | opus | high |
| execution | sonnet | medium |

## Valeurs organisationnelles
- Faire simple.
`;

function fiche(chemin, { profil = 'execution', effort = '', alloue = 2, consomme = 0, statut = 'READY' } = {}) {
  return `# ${chemin}\n| Champ | Valeur |\n|---|---|\n| Rôle | test |\n| Parent | x |\n| Statut | ${statut} |\n| Budget alloué / consommé | ${alloue} / ${consomme} |\n| Dépend de | — |\n${profil ? `| Profil | ${profil} |\n` : ''}${effort ? `| Effort | ${effort} |\n` : ''}| Livrables | — |\n| Créée / Archivée | 2026-09-02T00:00:00Z / — |\n`;
}
function status(etat, note = '') {
  return `# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | ${etat} |\n| Depuis | 2026-09-02T00:00:00Z |\n| Posé par | soi |\n| Note | ${note} |\n`;
}

/** Racine minimale avec `unites-indexees` actif, une instance `concepteur` et un enfant `concepteur/enfant`. */
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-u5-'));
  const w = (rel, content) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
  w('framework/KERNEL.md', '# KERNEL de test\nRègle K1.\n');
  w('framework/CONFIG.md', CONFIG_UNITES);
  w('framework/MANIFEST.md', '# MANIFEST\n');
  w('framework/BOOTSTRAP.md', '# BOOTSTRAP de test\n');
  w('framework/modules/orchestration/direct-spawn.md', '# Module : direct-spawn\n');
  w('framework/modules/synchronisation/fork-join.md', '# Module : fork-join\n');
  w('framework/modules/memoire/unites-indexees.md', fs.readFileSync(path.join(CIBLE, 'modules', 'memoire', 'unites-indexees.md'), 'utf8'));
  w('framework/modules/recursion/max-depth.md', '# Module : max-depth\n');
  w('framework/modules/registre/sharded-files.md', '# Module : sharded-files\n');
  w('framework/claude/instance-settings.json', '{}');
  w('mission/OBJECTIVE.md', 'Objectif de test.\n');
  w('mission/concepteur/ROLE.md', '# Rôle : concepteur\nMission racine de test.\n');
  w('mission/concepteur/MEMORY.md', '# Mémoire\n## État courant\nOK.\n');
  w('mission/concepteur/STATUS.md', status('WORKING'));
  w('mission/concepteur/INBOX.md', '# Boîte\n');
  w('mission/concepteur/OUTBOX.md', '# Boîte sortie\n');
  w('mission/concepteur/enfant/ROLE.md', '# Rôle : enfant\n');
  w('mission/concepteur/enfant/MEMORY.md', '# Mémoire enfant\n');
  w('mission/concepteur/enfant/STATUS.md', status('READY'));
  w('mission/concepteur/enfant/INBOX.md', '# Boîte enfant\n');
  w('mission/registry/instances/concepteur.md', fiche('concepteur', { profil: 'conception', alloue: 3 }));
  w('mission/registry/instances/concepteur-enfant.md', fiche('concepteur/enfant', { profil: 'execution', alloue: 1 }));
  w('mission/registry/PROGRESS.md', '# Avancement\n2026-09-02T00:00:00Z · concepteur · ON_ORIENT · plan\n');
  return root;
}

function runHook(event, input, env) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('node', [HOOKS, event], { input: JSON.stringify(input), encoding: 'utf8', env: Object.assign({}, process.env, env) });
  if (r.status !== 0) throw new Error(`hook ${event} exit ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout || '{}');
}

/** Init un dépôt git minimal dans `root`, avec un committer/auteur fixes (pour dates reproductibles). */
function gitInit(root) {
  const { spawnSync } = require('child_process');
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@test', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@test' });
  spawnSync('git', ['-C', root, 'init', '-q'], { env });
  spawnSync('git', ['-C', root, 'config', 'user.email', 't@test'], { env });
  spawnSync('git', ['-C', root, 'config', 'user.name', 'Test'], { env });
  return env;
}
/** Commit daté (ISO 8601) de tout `root`. */
function gitCommitAt(root, baseEnv, dateIso, message) {
  const { spawnSync } = require('child_process');
  const env = Object.assign({}, baseEnv, { GIT_AUTHOR_DATE: dateIso, GIT_COMMITTER_DATE: dateIso });
  spawnSync('git', ['-C', root, 'add', '-A'], { env });
  spawnSync('git', ['-C', root, 'commit', '-q', '-m', message, '--allow-empty'], { env });
}

module.exports = { LANCEUR, HOOKS, CIBLE, makeRoot, fiche, status, runHook, gitInit, gitCommitAt };

'use strict';
// Tests U4 (chantier 7, §9.1/§9.5) : option --agents construite par le lanceur pour le sous-agent
// `holarch-unite`, conditionnée par moduleActive(cfg, 'extensions', 'delegation-intra-session').
// Modèle : framework/tests/unites-indexees-setup.js (makeRoot), adapté pour activer ce module.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CIBLE = path.resolve(__dirname, '..');
const LANCEUR = require(path.join(CIBLE, 'bin', 'holarch-spawn.js'));

const CONFIG_DELEGATION = `# Configuration — mission : test-delegation-intra-session
> Preset de base : solo-light · Framework : v1.1

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
| 2 | synchronisation | fork-join |
| 3 | memoire | unites-indexees |
| 4 | recursion | max-depth |
| 5 | registre | sharded-files |
| 6 | extensions | delegation-intra-session |

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

const CONFIG_SANS_DELEGATION = CONFIG_DELEGATION.replace('| 6 | extensions | delegation-intra-session |\n', '');

function fiche(chemin) {
  return `# ${chemin}\n| Champ | Valeur |\n|---|---|\n| Rôle | test |\n| Parent | x |\n| Statut | READY |\n| Budget alloué / consommé | 1 / 0 |\n| Dépend de | — |\n| Profil | execution |\n| Livrables | — |\n| Créée / Archivée | 2026-09-11T00:00:00Z / — |\n`;
}
function status(etat) {
  return `# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | ${etat} |\n| Depuis | 2026-09-11T00:00:00Z |\n| Posé par | soi |\n| Note |  |\n`;
}

/** Racine jetable ; `avecDelegation` active ou non le module extensions/delegation-intra-session. */
function makeRoot({ avecDelegation = true, sansGabarit = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-u4-'));
  const w = (rel, contenu) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, contenu); };
  w('framework/KERNEL.md', '# KERNEL de test\nRègle K1.\n');
  w('framework/CONFIG.md', avecDelegation ? CONFIG_DELEGATION : CONFIG_SANS_DELEGATION);
  w('framework/MANIFEST.md', '# MANIFEST\n');
  w('framework/BOOTSTRAP.md', '# BOOTSTRAP de test\n');
  w('framework/modules/orchestration/direct-spawn.md', '# Module : direct-spawn\n');
  w('framework/modules/synchronisation/fork-join.md', '# Module : fork-join\n');
  w('framework/modules/memoire/unites-indexees.md', fs.readFileSync(path.join(CIBLE, 'modules', 'memoire', 'unites-indexees.md'), 'utf8'));
  w('framework/modules/recursion/max-depth.md', '# Module : max-depth\n');
  w('framework/modules/registre/sharded-files.md', '# Module : sharded-files\n');
  w('framework/modules/extensions/delegation-intra-session.md', fs.readFileSync(path.join(CIBLE, 'modules', 'extensions', 'delegation-intra-session.md'), 'utf8'));
  if (!sansGabarit) {
    w('framework/templates/SOUS-AGENT.template.md', fs.readFileSync(path.join(CIBLE, 'templates', 'SOUS-AGENT.template.md'), 'utf8'));
  }
  w('framework/claude/instance-settings.json', '{}');
  w('mission/OBJECTIVE.md', 'Objectif de test.\n');
  w('mission/concepteur/ROLE.md', '# Rôle : concepteur\n');
  w('mission/concepteur/MEMORY.md', '# Mémoire\n## État courant\nOK.\n');
  w('mission/concepteur/STATUS.md', status('WORKING'));
  w('mission/concepteur/INBOX.md', '# Boîte\n');
  w('mission/concepteur/OUTBOX.md', '# Boîte sortie\n');
  w('mission/concepteur/enfant/ROLE.md', '# Rôle : enfant\n');
  w('mission/concepteur/enfant/MEMORY.md', '# Mémoire enfant\n');
  w('mission/concepteur/enfant/STATUS.md', status('READY'));
  w('mission/concepteur/enfant/INBOX.md', '# Boîte enfant\n');
  w('mission/registry/instances/concepteur.md', fiche('concepteur'));
  w('mission/registry/instances/concepteur-enfant.md', fiche('concepteur/enfant'));
  w('mission/registry/PROGRESS.md', '# Avancement\n');
  return root;
}

function valeurApres(args, flag) {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

test('prepareLaunch : --agents absent si delegation-intra-session inactif', () => {
  const root = makeRoot({ avecDelegation: false });
  const l = LANCEUR.prepareLaunch(root, 'concepteur/enfant', {});
  assert.equal(LANCEUR.apercuCommande(l).args.includes('--agents'), false);
});

test('prepareLaunch : --agents présent avec la définition holarch-unite si le module est actif', () => {
  const root = makeRoot({ avecDelegation: true });
  const l = LANCEUR.prepareLaunch(root, 'concepteur/enfant', {});
  const args = LANCEUR.apercuCommande(l).args;
  assert.ok(args.includes('--agents'));
  const json = valeurApres(args, '--agents');
  const def = JSON.parse(json);
  assert.ok(def['holarch-unite']);
  const a = def['holarch-unite'];
  assert.deepEqual(a.tools, ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']); // tableau, pas une chaîne (le CLI rejette « holarch-unite.tools: Invalid input »)
  assert.equal(a.tools.includes('Agent'), false);
  assert.equal(a.model, 'sonnet');
  assert.ok(a.description.length > 0);
  const gabarit = fs.readFileSync(path.join(root, 'framework', 'templates', 'SOUS-AGENT.template.md'), 'utf8').trim();
  assert.equal(a.prompt, gabarit);
  assert.ok(a.prompt.length <= 2000, `prompt sous-agent ${a.prompt.length} caractères, attendu ≤ 2000`);
});

test('prepareLaunch : sous_agent_modele de CONFIG.md se répercute dans --agents', () => {
  const root = makeRoot({ avecDelegation: true });
  const cfgPath = path.join(root, 'framework', 'CONFIG.md');
  let cfg = fs.readFileSync(cfgPath, 'utf8');
  cfg = cfg.replace('| changements_regime_max | 1 |', '| changements_regime_max | 1 |\n| sous_agent_modele | opus |');
  fs.writeFileSync(cfgPath, cfg);
  const l = LANCEUR.prepareLaunch(root, 'concepteur/enfant', {});
  const def = JSON.parse(valeurApres(LANCEUR.apercuCommande(l).args, '--agents'));
  assert.equal(def['holarch-unite'].model, 'opus');
});

test('buildAgentsOption : null (fail-open) si le gabarit SOUS-AGENT.template.md est introuvable', () => {
  const root = makeRoot({ avecDelegation: true, sansGabarit: true });
  const params = LANCEUR.resolveParams(LANCEUR.parseConfig(fs.readFileSync(path.join(root, 'framework', 'CONFIG.md'), 'utf8')));
  assert.equal(LANCEUR.buildAgentsOption(root, params), null);
});

test('prepareLaunch : --tools garde Agent même quand delegation-intra-session est actif', () => {
  const root = makeRoot({ avecDelegation: true });
  const l = LANCEUR.prepareLaunch(root, 'concepteur/enfant', {});
  assert.match(valeurApres(LANCEUR.apercuCommande(l).args, '--tools'), /Agent/);
});

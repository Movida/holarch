'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { executer } = require('./lib/commun.js');

const CHEMIN_OPEN = path.join(__dirname, 'open.js');

const PRESET_SOLO_LIGHT = `# Preset : solo-light

> Le choix par défaut en cas d'hésitation.

\`\`\`markdown
# Configuration — mission : <nom de la mission>
> Preset de base : solo-light · Framework : v1.1

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |

## Paramètres
| Paramètre | Valeur |
|---|---|
| budget_instances_total | 5 |
| profondeur_max | 2 |
| seuil_contexte_tokens | 180000 |

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| execution | sonnet | medium |

## Valeurs organisationnelles
- En cas de doute entre faire seul et spawner, faire seul.
\`\`\`
`;

const PRESET_TEAM_STANDARD = `# Preset : team-standard

> Projet moyen.

\`\`\`markdown
# Configuration — mission : <nom de la mission>
> Preset de base : team-standard · Framework : v1.1

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
| 2 | synchronisation | dependency-graph |

## Paramètres
| Paramètre | Valeur |
|---|---|
| budget_instances_total | 15 |
| profondeur_max | 3 |
| seuil_contexte_tokens | 120000 |

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| execution | sonnet | medium |

## Valeurs organisationnelles
- Toute décomposition doit rester justifiable.
\`\`\`
`;

const CONFIG_INITIAL = `# Configuration — mission : ancienne-mission
> Preset de base : solo-light · Framework : v1.1

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |

## Paramètres
| Paramètre | Valeur |
|---|---|
| budget_instances_total | 5 |
| profondeur_max | 2 |

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| execution | sonnet | medium |

## Valeurs organisationnelles
- ne pas toucher cette section.
`;

const TEMPLATE_OBJECTIVE = `# Objectif — mission \`{{NOM}}\`

Chantier {{CHANTIER}}.

## Pourquoi

<!-- à compléter -->

## Chantier {{CHANTIER}}

<!-- à compléter -->

## Contraintes permanentes

- ne pas écrire sous framework/, docs/, tools/.

## Critères d'acceptation

<!-- à compléter -->

## Livrable final

<!-- à compléter -->
`;

/** Construit un dépôt Git jetable minimal : framework/presets/{solo-light,team-standard}.md,
 *  framework/CONFIG.md, framework/templates/OBJECTIVE.template.md, docs/ROADMAP.md et README.md avec
 *  leurs ancres — fixture structurellement fidèle mais minimale (pas le vrai contenu du dépôt). */
function creerFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-open-fixture-'));

  executer('git', ['init', '-q'], { cwd: root, doitReussir: true });
  executer('git', ['config', 'user.email', 'test@example.com'], { cwd: root, doitReussir: true });
  executer('git', ['config', 'user.name', 'Test'], { cwd: root, doitReussir: true });

  fs.writeFileSync(path.join(root, '.gitignore'), 'mission/.holarch/\n');

  fs.mkdirSync(path.join(root, 'framework', 'presets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'framework', 'presets', 'solo-light.md'), PRESET_SOLO_LIGHT);
  fs.writeFileSync(path.join(root, 'framework', 'presets', 'team-standard.md'), PRESET_TEAM_STANDARD);
  fs.writeFileSync(path.join(root, 'framework', 'CONFIG.md'), CONFIG_INITIAL);

  fs.mkdirSync(path.join(root, 'framework', 'templates'), { recursive: true });
  fs.writeFileSync(path.join(root, 'framework', 'templates', 'OBJECTIVE.template.md'), TEMPLATE_OBJECTIVE);

  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'ROADMAP.md'), '# ROADMAP\n\n## 5. Ordre des missions\n\n| Mission | Contenu | Précondition |\n|---|---|---|\n| `precedente` (**terminée**) | Chantier 7 | — |\n| Programme DEMIURGE | T10 | Chantiers 1-8 promus |\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# README\n\n- **Missions** : `precedente` (terminée).\n- autre puce\n');

  executer('git', ['add', '-A'], { cwd: root, doitReussir: true });
  executer('git', ['commit', '-m', 'init'], { cwd: root, doitReussir: true });

  return { root };
}

test('refus : mission/ existe déjà (contenu significatif)', () => {
  const { root } = creerFixture();
  try {
    fs.mkdirSync(path.join(root, 'mission'), { recursive: true });
    fs.writeFileSync(path.join(root, 'mission', 'OBJECTIVE.md'), 'déjà là\n');
    const r = executer('node', [CHEMIN_OPEN, 'nouvelle-mission', '--chantier', '9'], { cwd: root });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /mission\//);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refus : tâche détachée vivante (mission/.holarch/ seul, non significatif)', () => {
  const { root } = creerFixture();
  try {
    const dirTasks = path.join(root, 'mission', '.holarch', 'tasks');
    fs.mkdirSync(dirTasks, { recursive: true });
    fs.writeFileSync(
      path.join(dirTasks, 'tache-test.json'),
      JSON.stringify({ state: 'running', pid: process.pid }),
    );
    const r = executer('node', [CHEMIN_OPEN, 'nouvelle-mission', '--chantier', '9'], { cwd: root });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /[Tt]âche/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scénario nominal : preset par défaut (solo-light)', () => {
  const { root } = creerFixture();
  try {
    const r = executer('node', [CHEMIN_OPEN, 'test-mission', '--chantier', '8'], { cwd: root });
    assert.equal(r.code, 0, `code attendu 0, stderr : ${r.stderr}`);

    const objectif = fs.readFileSync(path.join(root, 'mission', 'OBJECTIVE.md'), 'utf8');
    assert.match(objectif, /test-mission/);
    assert.match(objectif, /Chantier 8|chantier 8/);
    assert.match(objectif, /## Pourquoi/);
    assert.match(objectif, /<!-- à compléter -->/);

    const config = fs.readFileSync(path.join(root, 'framework', 'CONFIG.md'), 'utf8');
    assert.match(config, /# Configuration — mission : test-mission/);
    assert.match(config, /\|\s*budget_instances_total\s*\|\s*5\s*\|/);
    assert.match(config, /ne pas toucher cette section\./, 'Valeurs organisationnelles préservées');

    const log = executer('git', ['log', '-1', '--oneline'], { cwd: root });
    assert.match(log.stdout, /\[open\] mission test-mission ouverte \(chantier 8\)/);

    const roadmap = fs.readFileSync(path.join(root, 'docs', 'ROADMAP.md'), 'utf8');
    assert.match(roadmap, /test-mission.*(en cours|ouverte)/);
    const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    assert.match(readme, /test-mission.*(en cours|ouverte)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('preset team-standard + surcharge --param', () => {
  const { root } = creerFixture();
  try {
    const r = executer('node', [
      CHEMIN_OPEN, 'autre-mission', '--chantier', '3',
      '--param', 'preset=team-standard',
      '--param', 'budget_instances_total=42',
      '--param', 'mode_attente=detache',
    ], { cwd: root });
    assert.equal(r.code, 0, `code attendu 0, stderr : ${r.stderr}`);

    const config = fs.readFileSync(path.join(root, 'framework', 'CONFIG.md'), 'utf8');
    assert.match(config, /\|\s*profondeur_max\s*\|\s*3\s*\|/, 'clé propre à team-standard');
    // Clé absente du preset : ajoutée en fin de table, collée à la ligne précédente (pas après une ligne vide).
    assert.match(config, /\|[^\n]*\|\n\|\s*mode_attente\s*\|\s*detache\s*\|\n\n## /, 'clé nouvelle dans la table, avant la ligne vide');
    assert.match(config, /\|\s*seuil_contexte_tokens\s*\|\s*120000\s*\|/, 'valeur team-standard, pas solo-light');
    assert.match(config, /\|\s*budget_instances_total\s*\|\s*42\s*\|/, 'surcharge --param prend le dessus');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refus : preset inexistant, liste les presets disponibles', () => {
  const { root } = creerFixture();
  try {
    const r = executer('node', [
      CHEMIN_OPEN, 'nouvelle-mission', '--chantier', '1', '--param', 'preset=inexistant',
    ], { cwd: root });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /inexistant/);
    assert.match(r.stderr, /solo-light/);
    assert.match(r.stderr, /team-standard/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('--sans-commit laisse les modifications non committées', () => {
  const { root } = creerFixture();
  try {
    const shaAvant = executer('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
    const r = executer('node', [CHEMIN_OPEN, 'test-mission', '--chantier', '8', '--sans-commit'], { cwd: root });
    assert.equal(r.code, 0, `code attendu 0, stderr : ${r.stderr}`);
    const shaApres = executer('git', ['rev-parse', 'HEAD'], { cwd: root }).stdout.trim();
    assert.equal(shaAvant, shaApres, 'HEAD ne doit pas bouger avec --sans-commit');

    const statut = executer('git', ['status', '--porcelain'], { cwd: root });
    assert.notEqual(statut.stdout.trim(), '', 'les modifications doivent rester non committées');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

'use strict';
/**
 * Tests de `config-lint.js` — mécanisation de l'Étape 1.3 de `framework/BOOTSTRAP.md` (T1).
 * Un test par classe d'erreur exigée par BOOTSTRAP.md, plus les avertissements et le CLI.
 *
 *   node --test tools/config-lint/config-lint.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const lint = require('./config-lint.js');

/** Racine HOLARCH par remontée (et non par chemin relatif figé) : le fichier doit rester exécutable
 *  depuis le bac à sable de `mutation-check.js`, où l'arborescence est reconstruite ailleurs. */
function racineHolarch(depart) {
  let dir = path.resolve(depart);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'framework', 'KERNEL.md'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  throw new Error(`racine HOLARCH introuvable depuis ${depart}`);
}

const RACINE = racineHolarch(__dirname);
const OUTIL = path.join(__dirname, 'config-lint.js');
const MANIFEST = fs.readFileSync(path.join(RACINE, 'framework/MANIFEST.md'), 'utf8');

/** Construit un CONFIG.md minimal et valide, que chaque test dégrade à sa façon. */
function config({ modules, parametres, politique, sansPolitique } = {}) {
  const mods = modules || [
    ['orchestration', 'direct-spawn'], ['synchronisation', 'fork-join'],
    ['memoire', 'monolithic'], ['registre', 'sharded-files'],
  ];
  const params = Object.assign({
    budget_instances_total: '5', profondeur_max: '2', langue_de_travail: 'fr',
    commit_par_session: 'oui', permission_mode: 'acceptEdits', format_rapport_final: 'simple',
  }, parametres || {});
  const pol = politique || [['conception', 'opus', 'high'], ['execution', 'sonnet', 'medium'], ['relecture', 'opus', 'medium'], ['exploration', 'fable', 'xhigh']];
  let texte = '# Configuration — mission : test\n\n## Modules actifs\n| # | Catégorie | Module |\n|---|---|---|\n';
  mods.forEach(([cat, nom], i) => { texte += `| ${i + 1} | ${cat} | ${nom} |\n`; });
  texte += '\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n';
  for (const [k, v] of Object.entries(params)) { if (v !== null) texte += `| ${k} | ${v} |\n`; }
  if (!sansPolitique) {
    texte += '\n## Politique de modèle\n| Profil | Modèle | Effort |\n|---|---|---|\n';
    pol.forEach(([p, m, e]) => { texte += `| ${p} | ${m} | ${e} |\n`; });
  }
  return texte;
}

/** Lint sur fixture ; `moduleTexts` vide par défaut (les paramètres de modules ne sont alors pas vérifiés). */
function run(configText, opts = {}) {
  return lint.lintConfig(Object.assign({ configText, manifestText: MANIFEST, moduleTexts: new Map() }, opts));
}

const contient = (liste, motif) => liste.some((m) => m.includes(motif));

// ---------------------------------------------------------------- référence

test('le CONFIG.md réel du dépôt passe sans erreur, modules et paramètres compris', () => {
  const r = lint.lintDepuisDisque({
    config: path.join(RACINE, 'framework/CONFIG.md'),
    manifest: path.join(RACINE, 'framework/MANIFEST.md'),
    modulesDir: path.join(RACINE, 'framework/modules'),
  });
  assert.deepStrictEqual(r.erreurs, [], 'aucune erreur attendue sur le CONFIG.md de la mission');
  assert.deepStrictEqual(r.avertissements, [], 'aucun avertissement attendu sur le CONFIG.md de la mission');
});

test('la fixture de référence est valide (sinon les tests suivants ne prouveraient rien)', () => {
  assert.deepStrictEqual(run(config()).erreurs, []);
});

// ------------------------------------------- 1.3.a — modules connus du MANIFEST

test('module actif absent du MANIFEST → erreur', () => {
  const r = run(config({ modules: [['orchestration', 'direct-spawn'], ['synchronisation', 'fork-join'],
    ['memoire', 'monolithic'], ['registre', 'sharded-files'], ['recursion', 'module-invente']] }));
  assert.ok(contient(r.erreurs, 'inconnu du MANIFEST : "module-invente"'), r.erreurs.join(' | '));
});

test('module actif déclaré deux fois → erreur', () => {
  const r = run(config({ modules: [['orchestration', 'direct-spawn'], ['synchronisation', 'fork-join'],
    ['memoire', 'monolithic'], ['registre', 'sharded-files'], ['recursion', 'max-depth'], ['recursion', 'max-depth']] }));
  assert.ok(contient(r.erreurs, 'en double : "max-depth"'), r.erreurs.join(' | '));
});

test('catégorie divergente entre CONFIG.md et MANIFEST → erreur', () => {
  const r = run(config({ modules: [['orchestration', 'direct-spawn'], ['synchronisation', 'fork-join'],
    ['memoire', 'monolithic'], ['registre', 'sharded-files'], ['conflits', 'max-depth']] }));
  assert.ok(contient(r.erreurs, '"max-depth" : catégorie "conflits" dans CONFIG.md'), r.erreurs.join(' | '));
});

// ------------------------------- 1.3.b — une et une seule catégorie obligatoire

test('catégorie obligatoire sans module actif → erreur nommant la catégorie', () => {
  const r = run(config({ modules: [['orchestration', 'direct-spawn'], ['synchronisation', 'fork-join'], ['memoire', 'monolithic']] }));
  assert.ok(contient(r.erreurs, 'catégorie obligatoire "registre" : aucun module actif'), r.erreurs.join(' | '));
});

test('deux modules dans une catégorie obligatoire → erreur', () => {
  const r = run(config({ modules: [['orchestration', 'direct-spawn'], ['synchronisation', 'fork-join'],
    ['memoire', 'monolithic'], ['memoire', 'journal-synthesis'], ['registre', 'sharded-files']] }));
  assert.ok(contient(r.erreurs, 'catégorie obligatoire "memoire" : 2 modules actifs'), r.erreurs.join(' | '));
});

// ------------------------------------------------- 1.3.c — incompatibilités

test('paire incompatible active (monolithic + journal-synthesis) → erreur, une seule fois', () => {
  const r = run(config({ modules: [['orchestration', 'direct-spawn'], ['synchronisation', 'fork-join'],
    ['memoire', 'monolithic'], ['memoire', 'journal-synthesis'], ['registre', 'sharded-files']] }));
  const incompat = r.erreurs.filter((m) => m.includes('incompatibles'));
  assert.strictEqual(incompat.length, 1, r.erreurs.join(' | '));
  assert.ok(incompat[0].includes('journal-synthesis + monolithic'), incompat[0]);
});

test('paire incompatible en synchronisation (fork-join + dependency-graph) → erreur', () => {
  const r = run(config({ modules: [['orchestration', 'direct-spawn'], ['synchronisation', 'fork-join'],
    ['synchronisation', 'dependency-graph'], ['memoire', 'monolithic'], ['registre', 'sharded-files']] }));
  assert.ok(contient(r.erreurs, 'dependency-graph + fork-join'), r.erreurs.join(' | '));
});

test('les incompatibilités viennent du MANIFEST, pas d\'une liste codée en dur', () => {
  const manifestText = MANIFEST.replace(
    '| [max-depth](modules/recursion/max-depth.md) | recursion | 1.0.0 | — | — |',
    '| [max-depth](modules/recursion/max-depth.md) | recursion | 1.0.0 | — | self-assessment |');
  const r = run(config({ modules: [['orchestration', 'direct-spawn'], ['synchronisation', 'fork-join'],
    ['memoire', 'monolithic'], ['registre', 'sharded-files'], ['recursion', 'max-depth'], ['recursion', 'self-assessment']] }), { manifestText });
  assert.ok(contient(r.erreurs, 'max-depth + self-assessment'), r.erreurs.join(' | '));
});

test('module requis par un module actif mais non actif → erreur', () => {
  const manifestText = MANIFEST.replace(
    '| [heartbeat-log](modules/observabilite/heartbeat-log.md) | observabilite | 1.0.0 | — |',
    '| [heartbeat-log](modules/observabilite/heartbeat-log.md) | observabilite | 1.0.0 | activity-log |');
  const r = run(config({ modules: [['orchestration', 'direct-spawn'], ['synchronisation', 'fork-join'],
    ['memoire', 'monolithic'], ['registre', 'sharded-files'], ['observabilite', 'heartbeat-log']] }), { manifestText });
  assert.ok(contient(r.erreurs, 'requiert "activity-log"'), r.erreurs.join(' | '));
});

// --------------------------------------- 1.3.d — paramètres requis des modules

test('paramètre sans défaut dans un module actif et absent de CONFIG.md → erreur', () => {
  const moduleTexts = new Map([['fork-join',
    '# Module : fork-join\n\n## Paramètres\n| Paramètre | Défaut | Description |\n|---|---|---|\n| delai_join |  | sans défaut, donc requis |\n']]);
  const r = run(config(), { moduleTexts });
  assert.ok(contient(r.erreurs, '"delai_join" requis par le module "fork-join"'), r.erreurs.join(' | '));
});

test('paramètre avec défaut explicite dans le module → aucune erreur', () => {
  const moduleTexts = new Map([['fork-join',
    '# Module : fork-join\n\n## Paramètres\n| Paramètre | Défaut | Description |\n|---|---|---|\n| delai_join | 3 | a un défaut |\n']]);
  assert.deepStrictEqual(run(config(), { moduleTexts }).erreurs, []);
});

test('paramètre hérité de CONFIG.md (instance-budget → budget_instances_total) → erreur si absent', () => {
  const moduleTexts = new Map([['instance-budget',
    '# Module : instance-budget\n\n## Paramètres\n| Paramètre | Défaut | Description |\n|---|---|---|\n| budget_total | *(hérité de `CONFIG.md` → `budget_instances_total`)* | — |\n']]);
  const mods = [['orchestration', 'direct-spawn'], ['synchronisation', 'fork-join'],
    ['memoire', 'monolithic'], ['registre', 'sharded-files'], ['recursion', 'instance-budget']];
  const sans = run(config({ modules: mods, parametres: { budget_instances_total: null } }), { moduleTexts });
  assert.ok(contient(sans.erreurs, '"budget_instances_total" requis par le module "instance-budget"'), sans.erreurs.join(' | '));
  const avec = run(config({ modules: mods }), { moduleTexts });
  assert.deepStrictEqual(avec.erreurs, []);
});

test('paramètre de CONFIG.md réclamé par aucun module actif → avertissement, pas erreur', () => {
  const r = run(config({ parametres: { taille_max: '30' } }));
  assert.deepStrictEqual(r.erreurs, []);
  assert.ok(contient(r.avertissements, '"taille_max" présent dans CONFIG.md'), r.avertissements.join(' | '));
});

test('module actif dont le fichier est introuvable → avertissement explicite, pas silence', () => {
  const r = run(config(), { moduleTexts: new Map() });
  assert.ok(contient(r.avertissements, 'fichier introuvable'), r.avertissements.join(' | '));
});

// ------------------------------------------- 1.3.e — paramètres transverses

test('permission_mode absent → erreur', () => {
  const r = run(config({ parametres: { permission_mode: null } }));
  assert.ok(contient(r.erreurs, 'obligatoire "permission_mode" absent'), r.erreurs.join(' | '));
});

test('permission_mode de valeur non reconnue → erreur listant les valeurs attendues', () => {
  const r = run(config({ parametres: { permission_mode: 'yolo' } }));
  assert.ok(contient(r.erreurs, '"permission_mode" : valeur "yolo" non reconnue'), r.erreurs.join(' | '));
  assert.ok(contient(r.erreurs, 'bypassPermissions'), 'le message doit énumérer les valeurs valides');
});

test('les sept permission_mode de BOOTSTRAP.md sont acceptés', () => {
  for (const mode of lint.PERMISSION_MODES) {
    assert.deepStrictEqual(run(config({ parametres: { permission_mode: mode } })).erreurs, [], mode);
  }
  assert.strictEqual(lint.PERMISSION_MODES.length, 7);
});

test('format_rapport_final absent ou invalide → erreur ; executive-summary accepté', () => {
  assert.ok(contient(run(config({ parametres: { format_rapport_final: null } })).erreurs, 'obligatoire "format_rapport_final" absent'));
  assert.ok(contient(run(config({ parametres: { format_rapport_final: 'detaille' } })).erreurs, 'valeur "detaille" non reconnue'));
  assert.deepStrictEqual(run(config({ parametres: { format_rapport_final: 'executive-summary' } })).erreurs, []);
});

// --------------------------- 1.3.f — politique de modèle et paramètres du harnais

test('profil inconnu dans la politique de modèle → erreur', () => {
  const r = run(config({ politique: [['conception', 'opus', 'high'], ['archiviste', 'opus', 'high']] }));
  assert.ok(contient(r.erreurs, 'profil "archiviste" inconnu'), r.erreurs.join(' | '));
});

test('effort non reconnu → erreur ; les cinq efforts valides passent', () => {
  assert.ok(contient(run(config({ politique: [['conception', 'opus', 'turbo']] })).erreurs, 'effort "turbo" non reconnu'));
  for (const effort of lint.EFFORTS) {
    const r = run(config({ politique: [['conception', 'opus', effort], ['execution', 'sonnet', effort], ['relecture', 'opus', effort]] }));
    assert.deepStrictEqual(r.erreurs, [], effort);
  }
});

test('profil sans modèle → erreur', () => {
  const r = run(config({ politique: [['conception', '—', 'high']] }));
  assert.ok(contient(r.erreurs, 'profil "conception" sans modèle'), r.erreurs.join(' | '));
});

test('haiku dans la politique → erreur si direct-spawn est actif (règle (b) du module)', () => {
  const r = run(config({ politique: [['execution', 'haiku', 'medium']] }));
  assert.ok(contient(r.erreurs, 'interdit haiku'), r.erreurs.join(' | '));
});

test('haiku → simple avertissement si direct-spawn n\'est pas le module d\'orchestration actif', () => {
  const manifestText = MANIFEST.replace('| [direct-spawn](modules/orchestration/direct-spawn.md) | orchestration |',
    '| [autre-spawn](modules/orchestration/autre-spawn.md) | orchestration |');
  const r = run(config({
    modules: [['orchestration', 'autre-spawn'], ['synchronisation', 'fork-join'], ['memoire', 'monolithic'], ['registre', 'sharded-files']],
    politique: [['execution', 'haiku', 'medium']],
  }), { manifestText });
  assert.deepStrictEqual(r.erreurs, []);
  assert.ok(contient(r.avertissements, 'interdit haiku'), r.avertissements.join(' | '));
});

test('profil non couvert par la politique → avertissement, pas erreur', () => {
  const r = run(config({ politique: [['conception', 'opus', 'high']] }));
  assert.deepStrictEqual(r.erreurs, []);
  assert.ok(contient(r.avertissements, 'profil "relecture" non couvert'), r.avertissements.join(' | '));
});

test('aucune politique de modèle déclarée → ni erreur ni avertissement (défauts de direct-spawn)', () => {
  const r = run(config({ sansPolitique: true }));
  assert.deepStrictEqual(r.erreurs, []);
  assert.deepStrictEqual(r.avertissements.filter((m) => m.includes('politique')), []);
});

test('paramètres du harnais : entiers positifs exigés, absence tolérée', () => {
  for (const nom of ['budget_usd_par_session', 'max_tours_par_session', 'seuil_contexte_tokens']) {
    assert.deepStrictEqual(run(config({ parametres: { [nom]: '5' } })).erreurs, [], `${nom}=5`);
    assert.ok(contient(run(config({ parametres: { [nom]: '0' } })).erreurs, `"${nom}" : "0"`), `${nom}=0`);
    assert.ok(contient(run(config({ parametres: { [nom]: '-3' } })).erreurs, `"${nom}" : "-3"`), `${nom}=-3`);
    assert.ok(contient(run(config({ parametres: { [nom]: 'beaucoup' } })).erreurs, `"${nom}" : "beaucoup"`), `${nom} texte`);
  }
  assert.deepStrictEqual(run(config()).erreurs, [], 'absence tolérée (BOOTSTRAP.md 1.3)');
});

// --------------------------------------------- 1.1 / 1.2 — contrôles bootstrap

test('--bootstrap-check sur un dépôt portant déjà une mission → erreurs (étape 1.2)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-lint-'));
  try {
    fs.mkdirSync(path.join(tmp, 'mission/registry'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'mission/concepteur'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'mission/OBJECTIVE.md'), '# objectif\n');
    const r = run(config(), { bootstrapCheck: true, racine: tmp });
    assert.ok(contient(r.erreurs, 'mission/registry" existe déjà'), r.erreurs.join(' | '));
    assert.ok(contient(r.erreurs, 'mission/concepteur" existe déjà'), r.erreurs.join(' | '));
    assert.strictEqual(r.erreurs.filter((m) => m.includes('OBJECTIVE.md est absent')).length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('--bootstrap-check sur un dépôt vierge → seule l\'absence d\'OBJECTIVE.md est signalée', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-lint-'));
  try {
    const r = run(config(), { bootstrapCheck: true, racine: tmp });
    assert.ok(contient(r.erreurs, 'mission/OBJECTIVE.md est absent'), r.erreurs.join(' | '));
    assert.strictEqual(r.erreurs.filter((m) => m.includes('existe déjà')).length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('sans --bootstrap-check, aucun contrôle de système de fichiers n\'est fait', () => {
  assert.deepStrictEqual(run(config(), { racine: RACINE }).erreurs, []);
});

// ------------------------------------------------------------ parsing unitaire

test('parseManifest lit 20 modules, leurs catégories et leurs incompatibilités', () => {
  // 20 = 14 côté framework public + `milestone-reviews`/`git-branches` (propres à cette mission)
  // - `activity-log` (non synchronisé, cf. registry/DECISIONS.md 2026-09-04T15:20:00Z)
  // + `reserve-hibernation`/`delegation-budget`/`role-personality` (mission holon-v2, itération 5-6,
  // catalogués le 2026-09-05, cf. registry/DECISIONS.md)
  // + `role-composition` (2026-09-07, ajouté hors holarchie, cf. registry/DECISIONS.md)
  // + `unites-indexees` (chantier 1, promu le 2026-09-10, framework 1.2.0).
  const m = lint.parseManifest(MANIFEST);
  assert.strictEqual(m.size, 20);
  assert.strictEqual(m.get('direct-spawn').categorie, 'orchestration');
  assert.deepStrictEqual(m.get('fork-join').incompatible, ['dependency-graph']);
  assert.deepStrictEqual(m.get('sharded-files').incompatible, []);
  assert.deepStrictEqual(m.get('unites-indexees').incompatible, ['monolithic', 'journal-synthesis']);
});

test('parseConfig lit modules, paramètres et politique du CONFIG.md réel', () => {
  const c = lint.parseConfig(fs.readFileSync(path.join(RACINE, 'framework/CONFIG.md'), 'utf8'));
  assert.ok(c.actifs.some((a) => a.nom === 'direct-spawn' && a.categorie === 'orchestration'));
  assert.strictEqual(c.parametres.get('permission_mode'), 'acceptEdits');
  assert.strictEqual(c.aPolitique, true);
  assert.strictEqual(c.politique.length, 4);
});

test('parseModuleParams distingue requis, optionnel et hérité', () => {
  const p = lint.parseModuleParams(
    '## Paramètres\n| Paramètre | Défaut | Description |\n|---|---|---|\n' +
    '| a |  | requis |\n| b | 3 | optionnel |\n| c | *(hérité de `CONFIG.md` → `budget_instances_total`)* | hérité |\n');
  assert.deepStrictEqual(p.map((x) => [x.nom, x.requis, x.heriteDe]),
    [['a', true, null], ['b', false, null], ['c', false, 'budget_instances_total']]);
});

test('un module sans section Paramètres ne produit aucun paramètre requis', () => {
  assert.deepStrictEqual(lint.parseModuleParams('# Module : x\n\n## Règles injectées\ntexte\n'), []);
});

// --------------------------------------------------------------------- CLI

test('CLI : exit 0 sur le CONFIG.md réel du dépôt', () => {
  const sortie = execFileSync(process.execPath, [OUTIL, 'framework/CONFIG.md'], { cwd: RACINE, encoding: 'utf8' });
  assert.match(sortie, /0 erreur\(s\)/);
});

test('CLI : exit 1 et diagnostic précis sur un CONFIG.md cassé', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-lint-'));
  try {
    fs.writeFileSync(path.join(tmp, 'CONFIG.md'), config({ parametres: { permission_mode: 'yolo' } }));
    fs.writeFileSync(path.join(tmp, 'MANIFEST.md'), MANIFEST);
    let code = 0; let sortie = '';
    try {
      sortie = execFileSync(process.execPath, [OUTIL, path.join(tmp, 'CONFIG.md')], { encoding: 'utf8' });
    } catch (e) { code = e.status; sortie = e.stdout; }
    assert.strictEqual(code, 1);
    assert.match(sortie, /ERREUR .*"permission_mode" : valeur "yolo"/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI : --json produit un objet parsable', () => {
  const sortie = execFileSync(process.execPath, [OUTIL, 'framework/CONFIG.md', '--json'], { cwd: RACINE, encoding: 'utf8' });
  const o = JSON.parse(sortie);
  assert.deepStrictEqual(o.erreurs, []);
  assert.ok(Array.isArray(o.avertissements));
});

test('CLI : fichier introuvable → exit 1 sans trace de pile', () => {
  let code = 0; let err = '';
  try {
    execFileSync(process.execPath, [OUTIL, 'framework/PAS-DE-CONFIG.md'], { cwd: RACINE, encoding: 'utf8', stdio: 'pipe' });
  } catch (e) { code = e.status; err = e.stderr; }
  assert.strictEqual(code, 1);
  assert.match(err, /^config-lint : /);
  assert.doesNotMatch(err, /at Object\./);
});

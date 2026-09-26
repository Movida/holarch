'use strict';
// Test du module `regles-du-metier` et du preset `artefacts` (chantier 17, docs/IMPLEMENTATION.md §17.1,
// mission holarch-specialisation). Modèle : framework/tests/delegation-intra-session-agents-option.test.js
// (racine jetable, require du lanceur) et mission/concepteur/workspace/mesure-preset-artefacts.js (méthode
// de construction du prompt système). Fonctionne aux deux emplacements : dans le paquet promouvable
// (mission/shared/concepteur/cible-framework/framework/tests/) et après promotion (framework/tests/).
//
// Seuil du test 5 : le contrat réduit de `contrat-reduit-regles-injectees.test.js` (55 000 caractères)
// ne vaut que pour sa fixture figée de 12 modules (solo-light). Le preset `artefacts` en active 14, dont
// `git-branches` (isolation = worktree) et `milestone-reviews`, plus pesants. Borne = MESURE + MARGE :
// MESURE = contrat réduit du preset mesuré le 2026-09-26 sur un clone où tout le paquet du chantier 17 est
// appliqué (milestone-reviews 1.1.0, fragments kits et veille de direct-spawn ; integration.js), contre 48 167
// pour solo-light ; MARGE = une ou deux puces de règle ajoutées par un chantier suivant avant remesure.
const MESURE_ARTEFACTS = 64947;
const MARGE_EVOLUTION = 2000;
const BORNE_ARTEFACTS = MESURE_ARTEFACTS + MARGE_EVOLUTION;
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CIBLE = path.resolve(__dirname, '..');

/** Premier ancêtre qui porte à la fois le lanceur et config-lint : le dépôt, que ce fichier tourne
 *  dans le paquet promouvable (dépôt = ancêtre lointain) ou déjà promu (dépôt = ancêtre immédiat). */
function trouverDepot(depart) {
  let d = depart;
  for (;;) {
    if (fs.existsSync(path.join(d, 'framework', 'bin', 'holarch-spawn.js'))
      && fs.existsSync(path.join(d, 'tools', 'config-lint', 'config-lint.js'))) return d;
    const parent = path.dirname(d);
    if (parent === d) throw new Error(`dépôt introuvable en remontant depuis ${depart}`);
    d = parent;
  }
}
const DEPOT = trouverDepot(path.resolve(__dirname, '..', '..'));

/** Fichier de CIBLE (le `framework/` du paquet ou du dépôt) s'il existe, sinon celui du dépôt réel. */
function pick(rel) {
  const p = path.join(CIBLE, rel);
  return fs.existsSync(p) ? p : path.join(DEPOT, 'framework', rel);
}

const LANCEUR = require(pick('bin/holarch-spawn.js'));
const VALIDATE_MODULE = path.join(DEPOT, 'tools', 'module-forge', 'validate-module.js');
const CONFIG_LINT = path.join(DEPOT, 'tools', 'config-lint', 'config-lint.js');

const PRESET_TEXTE = fs.readFileSync(pick('presets/artefacts.md'), 'utf8');
const CONFIG_ARTEFACTS = PRESET_TEXTE.match(/```markdown\n([\s\S]*?)\n```/)[1];

/** MANIFEST.md tel qu'il sera après promotion : dans le paquet, la ligne du module est un fragment
 *  (mode `fragment` de appliquer.js, inséré après la ligne `delegation-intra-session`) ; une fois
 *  promu, le MANIFEST.md du dépôt la porte déjà et le fragment n'existe plus. */
function manifestTexte() {
  let texte = fs.readFileSync(pick('MANIFEST.md'), 'utf8');
  const version = path.join(CIBLE, 'MANIFEST.milestone-reviews-version.fragment.md');
  if (fs.existsSync(version)) {
    texte = texte.replace('| [milestone-reviews](modules/extensions/milestone-reviews.md) | extensions | 1.0.0 |',
      fs.readFileSync(version, 'utf8').trimEnd());
  }
  const fragment = path.join(CIBLE, 'MANIFEST.regles-du-metier.fragment.md');
  if (texte.includes('| [regles-du-metier]') || !fs.existsSync(fragment)) return texte;
  const ancre = texte.indexOf('| [delegation-intra-session]');
  const fin = texte.indexOf('\n', ancre) + 1;
  return texte.slice(0, fin) + fs.readFileSync(fragment, 'utf8') + texte.slice(fin);
}

/** Racine jetable : KERNEL.md + modules réels du dépôt, `regles-du-metier.md` de CIBLE (celui sous
 *  test), MANIFEST.md promu (`manifestTexte`), CONFIG.md = bloc du preset `artefacts`. */
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-regles-du-metier-'));
  const fw = path.join(root, 'framework');
  fs.mkdirSync(fw, { recursive: true });
  fs.copyFileSync(pick('KERNEL.md'), path.join(fw, 'KERNEL.md'));
  fs.cpSync(path.join(DEPOT, 'framework', 'modules'), path.join(fw, 'modules'), { recursive: true });
  for (const m of ['regles-du-metier.md', 'milestone-reviews.md']) {
    fs.copyFileSync(pick(path.join('modules', 'extensions', m)), path.join(fw, 'modules', 'extensions', m));
  }
  fs.writeFileSync(path.join(fw, 'MANIFEST.md'), manifestTexte());
  fs.writeFileSync(path.join(fw, 'CONFIG.md'), `${CONFIG_ARTEFACTS}\n`);
  return root;
}

const ROOT = makeRoot();
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

test('validate-module module : regles-du-metier.md conforme au catalogue jetable', () => {
  const r = spawnSync(process.execPath, [
    VALIDATE_MODULE, 'module',
    path.join(ROOT, 'framework', 'modules', 'extensions', 'regles-du-metier.md'),
    '--manifest', path.join(ROOT, 'framework', 'MANIFEST.md'),
    '--modules-dir', path.join(ROOT, 'framework', 'modules'),
  ], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('composition du preset artefacts valide : config-lint et validate-module config, code 0', () => {
  const configPath = path.join(ROOT, 'framework', 'CONFIG.md');
  const manifestPath = path.join(ROOT, 'framework', 'MANIFEST.md');
  const modulesDir = path.join(ROOT, 'framework', 'modules');
  const rLint = spawnSync(process.execPath, [
    CONFIG_LINT, configPath, '--manifest', manifestPath, '--modules-dir', modulesDir,
  ], { encoding: 'utf8' });
  assert.equal(rLint.status, 0, rLint.stdout + rLint.stderr);
  const rValidate = spawnSync(process.execPath, [
    VALIDATE_MODULE, 'config', configPath, '--manifest', manifestPath, '--modules-dir', modulesDir,
  ], { encoding: 'utf8' });
  assert.equal(rValidate.status, 0, rValidate.stdout + rValidate.stderr);
});

test('preset artefacts : 14 modules dont les 4 attendus, paramètres attendus', () => {
  const cfg = LANCEUR.parseConfig(CONFIG_ARTEFACTS);
  assert.equal(cfg.modules.length, 14);
  for (const m of ['regles-du-metier', 'milestone-reviews', 'git-branches', 'delegation-intra-session']) {
    assert.ok(cfg.modules.some((x) => x.module === m), `module ${m} attendu dans le preset artefacts`);
  }
  const params = LANCEUR.resolveParams(cfg);
  assert.equal(params.mode_attente, 'detache');
  assert.equal(params.isolation, 'worktree');
  assert.equal(params.sessions_sans_unite_max, '3');
  assert.equal(params.budget_usd_par_session, '8');
});

test('règles injectées : ancres et mentions attendues, sections retirées', () => {
  const moduleText = fs.readFileSync(path.join(ROOT, 'framework', 'modules', 'extensions', 'regles-du-metier.md'), 'utf8');
  const extrait = LANCEUR.extraireEnTeteEtReglesInjectees(moduleText);
  for (const ancre of ['### ⚓ ON_ORIENT', '### ⚓ ON_DELIVER', '### ⚓ ON_SLEEP', '### ⚓ ON_CHILD_DONE']) {
    assert.ok(extrait.includes(ancre), `ancre ${ancre} attendue`);
  }
  assert.ok(extrait.includes('REGLES-OR.md') || extrait.includes('<fichier_regles>'), 'REGLES-OR.md ou <fichier_regles> attendu');
  assert.ok(extrait.includes('jalon_regles') || extrait.includes('J0'), 'jalon_regles ou J0 attendu');
  for (const motif of ['Veille', 'U0', '<kits>']) {
    assert.ok(extrait.includes(motif), `motif ${motif} attendu`);
  }
  assert.equal(extrait.includes('## Constat'), false);
  assert.equal(extrait.includes('## Ce que ce module ne fait pas'), false);
});

test('contrat réduit du preset artefacts : longueur bornée, mentionne regles-du-metier.md', (t) => {
  const cfg = LANCEUR.parseConfig(CONFIG_ARTEFACTS);
  const prompt = LANCEUR.buildSystemPrompt(ROOT, cfg, false);
  const n = prompt.length;
  t.diagnostic(`contrat réduit artefacts : ${n} / ${BORNE_ARTEFACTS} caractères, marge ${BORNE_ARTEFACTS - n}`);
  assert.ok(n < BORNE_ARTEFACTS, `prompt système ${n} caractères, attendu < ${BORNE_ARTEFACTS} (mesure ${MESURE_ARTEFACTS} + marge ${MARGE_EVOLUTION})`);
  assert.match(prompt, /regles-du-metier\.md/);
});

test('MANIFEST.md : ligne regles-du-metier présente, version alignée avec l\'en-tête du module', () => {
  const manifest = manifestTexte();
  assert.match(
    manifest,
    /\| \[regles-du-metier\]\(modules\/extensions\/regles-du-metier\.md\) \| extensions \| 1\.0\.0 \| — \| — \|/,
  );
  const moduleText = fs.readFileSync(path.join(CIBLE, 'modules', 'extensions', 'regles-du-metier.md'), 'utf8');
  const versionModule = moduleText.match(/^>\s*Version\s*:\s*(.+)$/m)[1].trim();
  const ligne = manifest.match(/\[regles-du-metier\]\([^)]*\)\s*\|\s*extensions\s*\|\s*([^\s|]+)\s*\|/);
  assert.ok(ligne, 'ligne regles-du-metier absente du MANIFEST.md');
  assert.equal(ligne[1], versionModule);
});

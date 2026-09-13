'use strict';
/**
 * U5 — colonne facultative « Permis » du catalogue de modèles, côté `config-lint.js`.
 * Preuve : la colonne est ignorée sans erreur quand absente, sans message quand la note est
 * suffisante (≥ 3/4), avertie (jamais une erreur) quand la note est insuffisante, et signalée en
 * erreur quand la cellule est présente mais illisible.
 *
 *   node --test mission/shared/concepteur/cible-tools/tools/config-lint/permis-colonne.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const lint = require('./config-lint.js');

/** Racine HOLARCH par remontée, sur le modèle de `config-lint.test.js`. */
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
const MANIFEST = fs.readFileSync(path.join(RACINE, 'framework/MANIFEST.md'), 'utf8');

/** Construit un CONFIG.md minimal et valide (mêmes bases que `config-lint.test.js`). */
function config() {
  let texte = '# Configuration — mission : test\n\n## Modules actifs\n| # | Catégorie | Module |\n|---|---|---|\n';
  [['orchestration', 'direct-spawn'], ['synchronisation', 'fork-join'],
    ['memoire', 'monolithic'], ['registre', 'sharded-files']].forEach(([cat, nom], i) => { texte += `| ${i + 1} | ${cat} | ${nom} |\n`; });
  texte += '\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n';
  const params = {
    budget_instances_total: '5', profondeur_max: '2', langue_de_travail: 'fr',
    commit_par_session: 'oui', permission_mode: 'acceptEdits', format_rapport_final: 'simple',
  };
  for (const [k, v] of Object.entries(params)) texte += `| ${k} | ${v} |\n`;
  return texte;
}

/** `config()` + catalogue avec une seule ligne de modèle, colonne Permis facultative. */
function avecCatalogue(celllulePermis) {
  const aPermis = celllulePermis !== undefined;
  const entete = aPermis
    ? '| Identifiant | Fournisseur | Modèle réel | Efforts | Coût entrée / sortie (USD par Mtok) | Aptitudes | Équivalent | Permis |'
    : '| Identifiant | Fournisseur | Modèle réel | Efforts | Coût entrée / sortie (USD par Mtok) | Aptitudes | Équivalent |';
  const separateur = aPermis ? '|---|---|---|---|---|---|---|---|' : '|---|---|---|---|---|---|---|';
  const ligne = aPermis
    ? `| fable | anthropic | claude-fable-5-1 | low…max | 3 / 15 | exploration | — | ${celllulePermis} |`
    : `| fable | anthropic | claude-fable-5-1 | low…max | 3 / 15 | exploration | — |`;
  return config()
    + '\n## Fournisseurs\n| Nom | Exécuteur | URL (variable) | Jeton (variable) | Secours |\n|---|---|---|---|---|\n'
    + '| anthropic | claude-code | — | — | — |\n'
    + `\n## Catalogue de modèles\n${entete}\n${separateur}\n${ligne}\n`;
}

function run(configText) {
  return lint.lintConfig({ configText, manifestText: MANIFEST, moduleTexts: new Map() });
}

const contient = (liste, motif) => liste.some((m) => m.includes(motif));

// ---------------------------------------------------------------- permisDeCellule (unitaire)

test('permisDeCellule : cellule absente ou vide → undefined (colonne facultative)', () => {
  assert.strictEqual(lint.permisDeCellule(undefined), undefined);
  assert.strictEqual(lint.permisDeCellule(''), undefined);
  assert.strictEqual(lint.permisDeCellule('—'), undefined);
});

test('permisDeCellule : cellule illisible → null', () => {
  assert.strictEqual(lint.permisDeCellule('bientôt'), null);
  assert.strictEqual(lint.permisDeCellule('5/4'), null);
});

test('permisDeCellule : cellule lisible → { date, note, sur }', () => {
  // Permis 1.1 (chantier 14, §15.3) : `permisDeCellule` expose aussi `k` (nombre de tirages) — sans
  // suffixe « ×k », k vaut 1 (« permis à un tirage »).
  assert.deepStrictEqual(lint.permisDeCellule('2026-09-12 4/4'), { date: '2026-09-12', note: 4, sur: 4, k: 1 });
});

// ---------------------------------------------------------------- lintConfig (bout en bout)

test('catalogue sans colonne Permis → aucun message relatif au permis', () => {
  const r = run(avecCatalogue(undefined));
  assert.deepStrictEqual(r.erreurs.filter((m) => m.toLowerCase().includes('permis')), []);
  assert.deepStrictEqual(r.avertissements.filter((m) => m.toLowerCase().includes('permis')), []);
});

test('catalogue avec colonne Permis « 2026-09-12 4/4 » → aucun message', () => {
  const r = run(avecCatalogue('2026-09-12 4/4'));
  assert.deepStrictEqual(r.erreurs.filter((m) => m.toLowerCase().includes('permis')), []);
  assert.deepStrictEqual(r.avertissements.filter((m) => m.toLowerCase().includes('permis')), []);
});

test('catalogue avec colonne Permis « 2026-09-12 1/4 » → avertissement, pas une erreur', () => {
  const r = run(avecCatalogue('2026-09-12 1/4'));
  assert.deepStrictEqual(r.erreurs.filter((m) => m.toLowerCase().includes('permis')), []);
  assert.ok(contient(r.avertissements, 'permis 1/4'), r.avertissements.join(' | '));
});

test('catalogue avec colonne Permis « bientôt » → erreur', () => {
  const r = run(avecCatalogue('bientôt'));
  assert.ok(contient(r.erreurs, 'permis "bientôt" illisible'), r.erreurs.join(' | '));
});

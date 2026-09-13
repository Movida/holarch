'use strict';
/**
 * Chantier 14 volet 3 (§15.3) — colonne « Permis » du catalogue de modèles, forme à 5 questions
 * avec tirages multiples (`AAAA-MM-JJ n/5 ×k`), compatible avec l'ancienne forme `AAAA-MM-JJ n/4`.
 * Preuve : `parsePermis` lit les deux formes, expose `sur` (le total, 4 ou 5) et `k` (le nombre de
 * tirages, 1 quand la colonne n'en porte pas), et `parseCatalogue` reste inchangé quand la colonne
 * est absente ou vide.
 *
 *   node mission/shared/concepteur/cible-framework/framework/tests/permis-colonne-5.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const catalogue = require('../bin/catalogue.js');

// ---------------------------------------------------------------- parsePermis, forme n/5 ×k

test('parsePermis : « 2026-09-13 4/5 ×3 » → note 4, total (sur) 5, k 3', () => {
  assert.deepStrictEqual(catalogue.parsePermis('2026-09-13 4/5 ×3'), { date: '2026-09-13', note: 4, sur: 5, k: 3 });
});

test('parsePermis : « x » ASCII toléré en lecture, même résultat que « × »', () => {
  assert.deepStrictEqual(catalogue.parsePermis('2026-09-13 4/5 x3'), { date: '2026-09-13', note: 4, sur: 5, k: 3 });
});

test('parsePermis : « 2026-09-13 4/5 » sans suffixe ×k → k vaut 1', () => {
  assert.deepStrictEqual(catalogue.parsePermis('2026-09-13 4/5'), { date: '2026-09-13', note: 4, sur: 5, k: 1 });
});

// ---------------------------------------------------------------- parsePermis, compatibilité n/4

test('parsePermis : « 2026-06-01 3/4 » lu comme avant (total 4), k vaut 1', () => {
  assert.deepStrictEqual(catalogue.parsePermis('2026-06-01 3/4'), { date: '2026-06-01', note: 3, sur: 4, k: 1 });
});

test('parsePermis : « 3/4 » sans date, ancienne forme, toujours lisible', () => {
  assert.deepStrictEqual(catalogue.parsePermis('3/4'), { date: null, note: 3, sur: 4, k: 1 });
});

// ---------------------------------------------------------------- parsePermis, colonne vide/absente/illisible

test('parsePermis : cellule absente, vide ou illisible → null (inchangé)', () => {
  assert.strictEqual(catalogue.parsePermis(undefined), null);
  assert.strictEqual(catalogue.parsePermis(''), null);
  assert.strictEqual(catalogue.parsePermis('—'), null);
  assert.strictEqual(catalogue.parsePermis('bientôt'), null);
  assert.strictEqual(catalogue.parsePermis('5/4'), null); // note > sur : illisible
});

test('parsePermis : « 2026-09-13 4/5 ×0 » — k inférieur à 1, illisible', () => {
  assert.strictEqual(catalogue.parsePermis('2026-09-13 4/5 ×0'), null);
});

// ---------------------------------------------------------------- parseCatalogue, colonne vide/absente inchangée

/** Petit CONFIG.md avec catalogue, colonne Permis présente (avec la cellule donnée) ou absente. */
function configAvecCatalogue(cellulePermis) {
  const avecColonne = cellulePermis !== undefined;
  const entete = avecColonne
    ? '| Identifiant | Fournisseur | Modèle réel | Efforts | Coût entrée / sortie (USD par Mtok) | Aptitudes | Équivalent | Fenêtre (tokens) | Permis |'
    : '| Identifiant | Fournisseur | Modèle réel | Efforts | Coût entrée / sortie (USD par Mtok) | Aptitudes | Équivalent | Fenêtre (tokens) |';
  const separateur = avecColonne ? '|---|---|---|---|---|---|---|---|---|' : '|---|---|---|---|---|---|---|---|';
  const ligneFable = avecColonne
    ? `| fable | anthropic | claude-fable-5-1 | low…max | 3 / 15 | exploration | — | 200000 | ${cellulePermis} |`
    : `| fable | anthropic | claude-fable-5-1 | low…max | 3 / 15 | exploration | — | 200000 |`;
  return '## Fournisseurs\n| Nom | Exécuteur | URL (variable) | Jeton (variable) | Secours |\n|---|---|---|---|---|\n'
    + '| anthropic | claude-code | — | — | — |\n\n'
    + `## Catalogue de modèles\n${entete}\n${separateur}\n${ligneFable}\n`;
}

test('parseCatalogue : colonne Permis « 2026-09-13 4/5 ×3 » → champ permis avec sur et k', () => {
  const cat = catalogue.parseCatalogue(configAvecCatalogue('2026-09-13 4/5 ×3'));
  assert.deepStrictEqual(cat.modeles.fable.permis, { date: '2026-09-13', note: 4, sur: 5, k: 3 });
});

test('parseCatalogue : colonne Permis absente → permis null, reste du modèle inchangé', () => {
  const cat = catalogue.parseCatalogue(configAvecCatalogue(undefined));
  const m = cat.modeles.fable;
  assert.strictEqual(m.permis, null);
  assert.strictEqual(m.fournisseur, 'anthropic');
  assert.strictEqual(m.cout_entree, 3);
  assert.strictEqual(m.cout_sortie, 15);
  assert.strictEqual(m.fenetre, 200000);
});

test('parseCatalogue : colonne Permis présente mais vide (« — ») → permis null', () => {
  const cat = catalogue.parseCatalogue(configAvecCatalogue('—'));
  assert.strictEqual(cat.modeles.fable.permis, null);
});

// ------------------------------------------- seuilPermis / ecartPermis à l'échelle /5 (§15.3)

const entree = (permis) => ({ id: 'fable', permis });

test('seuilPermis : 3 sur l\'échelle /4 (protocole 1.0), 4 sur l\'échelle /5 (protocole 1.1)', () => {
  assert.strictEqual(catalogue.seuilPermis(4), 3);
  assert.strictEqual(catalogue.seuilPermis(5), 4);
});

test('ecartPermis : permis 4/5 ×3 (au seuil, médiane établie) → null', () => {
  assert.strictEqual(catalogue.ecartPermis(entree({ date: '2026-09-13', note: 4, sur: 5, k: 3 })), null);
});

test('ecartPermis : permis 3/5 ×3 → message « 3/5 » sous le seuil « < 4/5 », jamais un refus', () => {
  const msg = catalogue.ecartPermis(entree({ date: '2026-09-13', note: 3, sur: 5, k: 3 }));
  assert.ok(msg && msg.includes('3/5'), `message attendu contenant « 3/5 », reçu : ${msg}`);
  assert.ok(msg.includes('< 4/5'), `seuil /5 attendu dans le message, reçu : ${msg}`);
  assert.ok(msg.includes('lancé tel quel'), 'un écart de permis avertit, il ne refuse pas');
});

test('ecartPermis : permis 5/5 ×1 (note au-dessus du seuil mais un seul tirage) → avertissement « un seul tirage »', () => {
  const msg = catalogue.ecartPermis(entree({ date: '2026-09-13', note: 5, sur: 5, k: 1 }));
  assert.ok(msg && msg.includes('un seul tirage'), `avertissement de tirage unique attendu, reçu : ${msg}`);
  assert.ok(msg.includes('lancé tel quel'), 'un permis à un tirage avertit, il ne refuse pas');
});

test('ecartPermis : permis 4/5 sans suffixe ×k (k = 1 par défaut) → même avertissement de tirage unique', () => {
  const msg = catalogue.ecartPermis(entree(catalogue.parsePermis('2026-09-13 4/5')));
  assert.ok(msg && msg.includes('un seul tirage'), `avertissement de tirage unique attendu, reçu : ${msg}`);
});

test('ecartPermis : ancienne forme 3/4 (au seuil de son échelle) → null, comportement 1.0 inchangé', () => {
  assert.strictEqual(catalogue.ecartPermis(entree({ date: '2026-09-12', note: 3, sur: 4, k: 1 })), null);
  assert.strictEqual(catalogue.ecartPermis(entree(catalogue.parsePermis('2026-09-12 4/4'))), null);
});

test('ecartPermis : ancienne forme 2/4 → message « < 3/4 » (seuil de l\'échelle /4)', () => {
  const msg = catalogue.ecartPermis(entree({ date: '2026-09-12', note: 2, sur: 4, k: 1 }));
  assert.ok(msg && msg.includes('2/4') && msg.includes('< 3/4'), `message attendu « 2/4 … < 3/4 », reçu : ${msg}`);
});

test('ecartPermis : seuil passé explicitement par l\'appelant → il prime sur le seuil d\'échelle', () => {
  const msg = catalogue.ecartPermis(entree({ date: '2026-09-13', note: 4, sur: 5, k: 3 }), 5);
  assert.ok(msg && msg.includes('< 5/5'), `seuil explicite attendu dans le message, reçu : ${msg}`);
  assert.strictEqual(catalogue.ecartPermis(entree({ date: '2026-09-13', note: 3, sur: 5, k: 3 }), 3), null);
});

test('ecartPermis : entrée sans permis, ou entrée absente → message « sans permis », ou null', () => {
  assert.strictEqual(catalogue.ecartPermis(null), null);
  const msg = catalogue.ecartPermis(entree(null));
  assert.ok(msg && msg.includes('sans permis'), `message « sans permis » attendu, reçu : ${msg}`);
});

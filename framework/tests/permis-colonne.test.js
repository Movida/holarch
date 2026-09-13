'use strict';
/**
 * U5 — colonne facultative « Permis » du catalogue de modèles (`framework/bin/catalogue.js`).
 * Preuve : la colonne est lue quand présente, ignorée sans erreur quand absente, et un modèle sans
 * permis ou < 3/4 produit un avertissement (jamais un refus).
 *
 *   node --test mission/shared/concepteur/cible-framework/framework/tests/permis-colonne.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const catalogue = require('../bin/catalogue.js');

// ---------------------------------------------------------------- parsePermis

test('parsePermis : cellule absente, vide ou illisible → null', () => {
  assert.strictEqual(catalogue.parsePermis(undefined), null);
  assert.strictEqual(catalogue.parsePermis(''), null);
  assert.strictEqual(catalogue.parsePermis('—'), null);
  assert.strictEqual(catalogue.parsePermis('bientôt'), null);
  assert.strictEqual(catalogue.parsePermis('5/4'), null); // note > sur : illisible
});

test('parsePermis : « 2026-09-12 4/4 » → date, note et sur lisibles', () => {
  // Permis 1.1 (chantier 14, §15.3) : `parsePermis` expose aussi `k` (nombre de tirages) — sans
  // suffixe « ×k », k vaut 1 (« permis à un tirage »).
  assert.deepStrictEqual(catalogue.parsePermis('2026-09-12 4/4'), { date: '2026-09-12', note: 4, sur: 4, k: 1 });
});

test('parsePermis : « 3/4 » sans date → date null', () => {
  assert.deepStrictEqual(catalogue.parsePermis('3/4'), { date: null, note: 3, sur: 4, k: 1 });
});

test('parsePermis : séparateur « · » entre date et note → note lue', () => {
  const p = catalogue.parsePermis('2026-09-12 · 2/4');
  assert.strictEqual(p.note, 2);
  assert.strictEqual(p.date, '2026-09-12');
});

// ---------------------------------------------------------------- parseCatalogue

/** Petit CONFIG.md avec catalogue, colonne Permis présente ou absente selon `avecPermis`. */
function configAvecCatalogue(avecPermis, celluleFable) {
  const entete = avecPermis
    ? '| Identifiant | Fournisseur | Modèle réel | Efforts | Coût entrée / sortie (USD par Mtok) | Aptitudes | Équivalent | Fenêtre (tokens) | Permis |'
    : '| Identifiant | Fournisseur | Modèle réel | Efforts | Coût entrée / sortie (USD par Mtok) | Aptitudes | Équivalent | Fenêtre (tokens) |';
  const separateur = avecPermis ? '|---|---|---|---|---|---|---|---|---|' : '|---|---|---|---|---|---|---|---|';
  const ligneFable = avecPermis
    ? `| fable | anthropic | claude-fable-5-1 | low…max | 3 / 15 | exploration | — | 200000 | ${celluleFable} |`
    : `| fable | anthropic | claude-fable-5-1 | low…max | 3 / 15 | exploration | — | 200000 |`;
  return '## Fournisseurs\n| Nom | Exécuteur | URL (variable) | Jeton (variable) | Secours |\n|---|---|---|---|---|\n'
    + '| anthropic | claude-code | — | — | — |\n\n'
    + `## Catalogue de modèles\n${entete}\n${separateur}\n${ligneFable}\n`;
}

test('parseCatalogue : colonne Permis présente → champ permis renseigné', () => {
  const cat = catalogue.parseCatalogue(configAvecCatalogue(true, '2026-09-12 4/4'));
  const m = cat.modeles.fable;
  // Permis 1.1 : `k` fait partie de l'objet rendu par `parsePermis`, y compris ici (k vaut 1 sans « ×k »).
  assert.deepStrictEqual(m.permis, { date: '2026-09-12', note: 4, sur: 4, k: 1 });
});

test('parseCatalogue : colonne Permis absente → permis null, reste du modèle inchangé', () => {
  const cat = catalogue.parseCatalogue(configAvecCatalogue(false));
  const m = cat.modeles.fable;
  assert.strictEqual(m.permis, null);
  assert.strictEqual(m.fournisseur, 'anthropic');
  assert.deepStrictEqual(m.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.strictEqual(m.cout_entree, 3);
  assert.strictEqual(m.cout_sortie, 15);
  assert.strictEqual(m.fenetre, 200000);
});

// ---------------------------------------------------------------- ecartPermis

test('ecartPermis : entrée null → null (rien à signaler)', () => {
  assert.strictEqual(catalogue.ecartPermis(null), null);
});

test('ecartPermis : permis 4/4 → null', () => {
  assert.strictEqual(catalogue.ecartPermis({ id: 'fable', permis: { date: '2026-09-12', note: 4, sur: 4 } }), null);
});

test('ecartPermis : permis 3/4 (au seuil) → null', () => {
  assert.strictEqual(catalogue.ecartPermis({ id: 'fable', permis: { date: '2026-09-12', note: 3, sur: 4 } }), null);
});

test('ecartPermis : permis 2/4 → message contenant "2/4"', () => {
  const msg = catalogue.ecartPermis({ id: 'fable', permis: { date: '2026-09-12', note: 2, sur: 4 } });
  assert.ok(typeof msg === 'string' && msg.includes('2/4'), msg);
});

test('ecartPermis : permis absent → message contenant "sans permis"', () => {
  const msg = catalogue.ecartPermis({ id: 'fable', permis: null });
  assert.ok(typeof msg === 'string' && msg.includes('sans permis'), msg);
});

// ---------------------------------------------------------------- câblage du lanceur (test structurel)

// Test structurel, pas d'exécution : la copie de `holarch-spawn.js` sous `cible-framework/` n'est pas
// exécutable hors du dépôt promu (elle requiert `./executeurs/`, absent de cette arborescence). On
// vérifie donc, sur le texte du fichier, que l'avertissement est bien câblé sans jamais bloquer.
test('holarch-spawn.js : enrichirMeta appelle catalogue.ecartPermis et avertit sur stderr, sans jamais refuser', () => {
  const texte = fs.readFileSync(path.join(__dirname, '..', 'bin', 'holarch-spawn.js'), 'utf8');
  assert.ok(texte.includes('catalogue.ecartPermis('), 'appel à catalogue.ecartPermis introuvable');
  const ligneAppel = texte.split('\n').findIndex((l) => l.includes('catalogue.ecartPermis('));
  assert.ok(ligneAppel >= 0);
  const bloc = texte.split('\n').slice(ligneAppel, ligneAppel + 2).join('\n');
  assert.ok(bloc.includes('process.stderr.write'), bloc);
  assert.ok(!bloc.includes('throw'), bloc);
  assert.ok(!bloc.includes('process.exit'), bloc);
});
